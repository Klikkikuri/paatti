"""The Paatti extension, loaded into Chromium, against a live Ilta-Pulu.

Chromium is the dev container's, the same one that the paatti skill drives: /usr/lib/chromium/chromium, never the
/usr/bin/chromium wrapper, which injects an empty --load-extension=. A headless run cannot answer a permission
prompt, so the harness loads a copy of the extension whose manifest.json also requires http://localhost/*. That is
the only change to the extension under test. All other setup calls the extension's own modules.
"""

import json
import shutil
import socket
import threading
import time
from pathlib import Path

import pytest
import uvicorn
from playwright.sync_api import sync_playwright

from paatti_devserver.app import create_app
from paatti_devserver.settings import ChaosSettings, Settings

LOCALHOST_GRANT = "http://localhost/*"


def pytest_addoption(parser):
    parser.addoption("--extension-dir", default=None, help="The unpacked extension to test (for example build/dist)")
    parser.addoption("--chromium", default="/usr/lib/chromium/chromium", help="The Chromium executable")
    parser.addoption("--e2e-seeds", default="1,2,3,42", help="The page seeds to check, comma-separated")


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class LiveServer:
    """A server in a thread of the test process, on a free port, with its own settings."""

    def __init__(self, **overrides):
        self.port = free_port()
        self.settings = Settings.model_validate({"port": self.port, **overrides})
        self.app = create_app(self.settings)
        config = uvicorn.Config(self.app, host="127.0.0.1", port=self.port, log_level="warning")
        self.server = uvicorn.Server(config)
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    @property
    def base(self) -> str:
        return f"http://localhost:{self.port}"

    @property
    def manifest_url(self) -> str:
        return f"{self.base}/manifest/ilta-pulu/manifest.json"

    def set_chaos(self, **chaos):
        """Switch the provider faults of the running server, for example between a clean refresh and a failing one."""
        self.app.state.chaos.chaos = ChaosSettings(**chaos)

    def __enter__(self):
        self.thread.start()
        while not self.server.started:
            time.sleep(0.05)
        return self

    def __exit__(self, *exc):
        self.server.should_exit = True
        self.thread.join(timeout=10)


def staged_extension(source: Path, target: Path) -> Path:
    shutil.copytree(source, target)
    manifest_path = target / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["host_permissions"] = [*manifest.get("host_permissions", []), LOCALHOST_GRANT]
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"\n[e2e] loaded a copy of {source} whose manifest.json also requires {LOCALHOST_GRANT}")
    return target


@pytest.fixture(scope="session")
def extension_dir(request, tmp_path_factory) -> Path:
    source = request.config.getoption("--extension-dir")
    if not source:
        pytest.skip("--extension-dir is not set")
    return staged_extension(Path(source).resolve(), tmp_path_factory.mktemp("extension") / "paatti")


@pytest.fixture(scope="session")
def seeds(request) -> list[int]:
    return [int(seed) for seed in request.config.getoption("--e2e-seeds").split(",")]


class Browser:
    """A persistent Chromium context with the extension, and helpers that run extension code."""

    def __init__(self, context, extension_id: str):
        self.context = context
        self.extension_id = extension_id

    def extension_page(self):
        page = self.context.new_page()
        page.goto(f"chrome-extension://{self.extension_id}/src/options/index.html")
        return page

    def run(self, script: str, arg=None):
        page = self.extension_page()
        try:
            return page.evaluate(script, arg)
        finally:
            page.close()

    def add_provider(self, manifest_url: str):
        """Turn on loopback providers, add and refresh the provider, and turn on its site: the options page's path."""
        return self.run("""async (manifestUrl) => {
            const { getConfig } = await import("/src/config.js");
            for (let i = 0; i < 50 && (await getConfig()).environment !== "development"; i++) {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            const { controller } = await import("/src/controller.js");
            const { addProvider, refreshProviders } = await import("/src/providers.js");
            await controller.setLoopbackProvidersEnabled(true);
            await addProvider(manifestUrl);
            await refreshProviders();
            await controller.setSiteEnabled(true, "localhost");
            const config = await getConfig();
            return { environment: config.environment, data: config.providerData[manifestUrl] };
        }""", manifest_url)

    def refresh(self):
        """One refresh pass over the providers, as a database update runs it. Returns its results."""
        return self.run("""async () => {
            const { refreshProviders } = await import("/src/providers.js");
            return refreshProviders();
        }""")

    def provider_data(self, manifest_url: str):
        return self.run("""async (manifestUrl) => {
            const { getConfig } = await import("/src/config.js");
            const data = (await getConfig()).providerData[manifestUrl];
            return data && { errors: data.errors, rejected: data.rejected, entryCount: data.entryCount,
                             updated: data.updated, checked: data.checked, sites: Object.keys(data.siteConfigs),
                             hasRules: Boolean(data.suolaRules) };
        }""", manifest_url)


@pytest.fixture
def browser(request, extension_dir, tmp_path):
    chromium = request.config.getoption("--chromium")
    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(
            str(tmp_path / "profile"),
            executable_path=chromium,
            headless=True,
            args=[f"--disable-extensions-except={extension_dir}", f"--load-extension={extension_dir}",
                  "--no-sandbox", "--disable-dev-shm-usage"],
        )
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
            yield Browser(context, worker.url.split("/")[2])
        finally:
            context.close()


def statuses(page) -> dict:
    """How many containers have each data-klikkikuri-status."""
    return page.evaluate("""() => {
        const counts = {};
        for (const element of document.querySelectorAll("[data-klikkikuri-status]")) {
            counts[element.dataset.klikkikuriStatus] = (counts[element.dataset.klikkikuriStatus] || 0) + 1;
        }
        return counts;
    }""")


def wait_until(predicate, timeout_s: float = 20.0, interval_s: float = 0.25):
    """The first true value of `predicate()`, or its last value when the time runs out."""
    deadline = time.monotonic() + timeout_s
    value = predicate()
    while not value and time.monotonic() < deadline:
        time.sleep(interval_s)
        value = predicate()
    return value


def wait_for_mismatches(page, timeout_s: float = 25.0) -> list:
    """The self-check mismatches, once there are none, or the last list when the time runs out."""
    deadline = time.monotonic() + timeout_s
    found = None
    while time.monotonic() < deadline:
        found = page.evaluate("() => window.devserverMismatches ? window.devserverMismatches() : null")
        if found == []:
            return found
        time.sleep(0.5)
    return found
