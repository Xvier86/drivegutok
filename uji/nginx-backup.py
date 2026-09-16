#!/usr/bin/env python3
"""Run vps-nginx.sh against local files + command stubs; no root/network/nginx."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "vps-nginx.sh"
CONFIG = """server {
    listen 80;
    server_name fixture.invalid;
    client_max_body_size 1M;
    location / {
        proxy_pass http://127.0.0.1:3000;
    }
}
"""
STUB = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ["CALLS"], "a") as log:
    log.write(json.dumps([name, *args]) + "\n")
if name == "id":
    print("0")  # Exercise root branch without actual privileges.
elif name == "sudo":
    sys.exit("unexpected sudo")
elif name == "nginx":
    if "-t" in args:
        # Real nginx warns but exits zero for duplicate server names.
        if len(list(pathlib.Path(os.environ["NGINX_CONF"]).parent.iterdir())) > 1:
            print("conflicting server name fixture.invalid, ignored", file=sys.stderr)
        sys.exit(int(os.environ.get("NGINX_FAIL", "0")))
    print(pathlib.Path(os.environ["NGINX_CONF"]).read_text())
elif name == "curl":
    if "-D" in args:
        print("HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\n\r\n")
    else:
        print("401")
elif name in ("cp", "mkdir"):
    if name == os.environ.get("BACKUP_FAIL") and args[-1].startswith(os.environ["BACKUP_DIR"]):
        sys.exit(1)
    os.execv(os.environ["REAL_" + name.upper()], [name, *args])
'''


class NginxBackup(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="nginx-backup-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.enabled = self.root / "sites-enabled"
        self.enabled.mkdir()
        self.target = self.root / "available.conf"
        self.target.write_text(CONFIG)
        self.target.chmod(0o640)
        self.conf = self.enabled / "fixture.conf"
        self.conf.symlink_to(self.target)
        self.backups = self.root / "backups"
        self.log = self.root / "calls.jsonl"
        bin_dir = self.root / "bin"
        bin_dir.mkdir()
        for name in ("id", "sudo", "nginx", "systemctl", "service", "curl", "cp", "mkdir"):
            stub = bin_dir / name
            stub.write_text(STUB)
            stub.chmod(0o755)
        cp, mkdir = shutil.which("cp"), shutil.which("mkdir")
        assert cp and mkdir, "cp + mkdir required"
        self.env = dict(os.environ, PATH=f"{bin_dir}:{os.environ['PATH']}",
                        NGINX_CONF=str(self.conf), BACKUP_DIR=str(self.backups),
                        DOMAIN="fixture.invalid", PUBLIK="https://fixture.invalid", PORT="3000",
                        MIN_BODY="5G", DRY="0", APP_DIR=str(self.root / "absent-app"),
                        CALLS=str(self.log), REAL_CP=cp, REAL_MKDIR=mkdir,
                        BACKUP_FAIL="", NGINX_FAIL="0")

    def run_script(self, **env):
        return subprocess.run(["bash", str(SCRIPT)], env=dict(self.env, **env),
                              capture_output=True, text=True, timeout=15)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def test_backup_outside_include_preserves_live_symlink_and_mode(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(list(self.enabled.iterdir()), [self.conf],
                         "backup is loaded by sites-enabled/*, duplicating server blocks")
        backups = list(self.backups.iterdir())
        self.assertEqual(len(backups), 1)
        self.assertFalse(backups[0].is_symlink(), "backup must contain old bytes, not a live link")
        self.assertEqual(backups[0].read_text(), CONFIG)
        self.assertEqual(backups[0].stat().st_mode & 0o777, 0o640)
        self.assertTrue(self.conf.is_symlink())
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o640)
        self.assertIn("client_max_body_size 5G;", self.target.read_text())
        self.assertIn(["systemctl", "reload", "nginx"], self.calls())

    def test_failed_backup_never_mutates_config_or_reloads(self):
        for command in ("mkdir", "cp"):
            with self.subTest(command=command):
                self.log.write_text("")
                self.target.write_text(CONFIG)
                result = self.run_script(BACKUP_FAIL=command)
                self.assertNotEqual(result.returncode, 0, "backup failure must abort")
                self.assertEqual(self.target.read_text(), CONFIG)
                self.assertTrue(self.conf.is_symlink())
                self.assertFalse(any(c[0] in ("nginx", "systemctl", "service", "curl")
                                     for c in self.calls()))

    def test_invalid_config_restores_backup_without_reload(self):
        result = self.run_script(NGINX_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.target.read_text(), CONFIG)
        self.assertTrue(self.conf.is_symlink())
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o640)
        self.assertFalse(any(c[0] in ("systemctl", "service", "curl") for c in self.calls()))

    def test_dry_run_never_writes_backup_or_config(self):
        result = self.run_script(DRY="1")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.target.read_text(), CONFIG)
        self.assertEqual(list(self.enabled.iterdir()), [self.conf])
        self.assertFalse(self.backups.exists())
        self.assertFalse(any(c[0] in ("nginx", "systemctl", "service", "curl") for c in self.calls()))

    def test_gzip_types_cover_express5_javascript_on_install_and_rerun(self):
        for existing in ("", "    gzip on;\n",
                         "    gzip on;\n    gzip_types text/css application/javascript;\n",
                         "    gzip on;\n    gzip_types text/css application/javascript; # text/javascript omitted\n",
                         "    gzip on;\n    gzip_types text/css\n        application/javascript;\n",
                         "    gzip on;\n    gzip_types text/css text/javascript;\n"):
            for body in ("    client_max_body_size 1M;\n", ""):
                with self.subTest(existing=existing, body=body):
                    self.target.write_text(CONFIG.replace("    client_max_body_size 1M;\n", body + existing))
                    result = self.run_script(DRY="1")
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    installed = result.stdout.split("nginx tidak direload.\n", 1)[1]
                    types = re.findall(r"(?m)^\s*gzip_types\s+([^;]+);", installed)
                    self.assertEqual(len(types), 1, "exactly one gzip_types directive")
                    self.assertEqual(types[0].split().count("text/javascript"), 1,
                                     "Express 5 sends text/javascript, not application/javascript")
                    self.assertIn("text/css", types[0].split())
                    self.assertEqual(re.findall(r"#[^\n]*", installed), re.findall(r"#[^\n]*", existing))
                    self.target.write_text(installed)
                    rerun = self.run_script(DRY="1")
                    self.assertEqual(rerun.returncode, 0, rerun.stdout + rerun.stderr)
                    self.assertEqual(rerun.stdout.split("nginx tidak direload.\n", 1)[1], installed)

    def test_gzip_probe_hits_nginx_with_site_host(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        probes = [c for c in self.calls() if c[0] == "curl" and "Accept-Encoding: gzip" in c]
        self.assertTrue(probes, "gzip probe required")
        for probe in probes:
            self.assertIn("Host: fixture.invalid", probe)
            self.assertIn("http://127.0.0.1/styles/components.css", probe)
            self.assertFalse(any(":3000/" in arg for arg in probe), "Express bypasses nginx gzip")


if __name__ == "__main__":
    unittest.main(verbosity=2)
