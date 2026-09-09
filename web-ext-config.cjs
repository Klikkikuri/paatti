module.exports = {
  verbose: false,
  run: {
    pref: [
      "browser.translations.automaticallyPopup=false",
      "browser.aboutwelcome.enabled=false",
      "browser.startup.homepage_override.mstone=ignore",
      "devtools.console.stdout.chrome=true",
      "devtools.console.stdout.content=true",
      "startup.homepage_welcome_url="
    ],
    // `ignoreFiles` only filters change events after the fact - watchpack still places an inotify watch on every
    // directory below the source dir. These patterns keep it out of the heavy, noisy trees entirely, which matters
    // in the devcontainer where the bind mount emits several events per write. Anchored at the start of an absolute
    // path, so each entry needs the `**/` prefix; no negation support, hence the per-directory build entries that
    // leave build/js.wasm and build/wasm_exec.js watched so a Wasm rebuild still reloads.
    watchIgnored: [
      "**/.git",
      "**/.codegraph/",
      "**/node_modules",
      "**/.venv",
      "**/__pycache__",
      "**/.pytest_cache",
      "**/web-ext-artifacts",
      "**/suola",
      "**/docs",
      "**/tests",
      "**/test_data",
      "**/build/dist",
      "**/build/e2e-screenshots",
      "**/*.log",
      "**/*.zip",
      "**/*.xpi"
    ]
  },
  // Globs are matched against the full path, so a trailing `/**` is required to reach nested files.
  // build/ is generated except for the two Wasm artifacts the manifest and src/background.js load at runtime.
  ignoreFiles: [
    'package-lock.json',
    'yarn.lock',
    'build/**',
    '.codegraph/**',
    '!build/js.wasm',
    '!build/wasm_exec.js',
    'suola/**',
    'tests/**',
    'test_data/**',
    'scripts/**',
    'docs/**',
    '!docs/PRIVACY_POLICY.md',
    'assets/sources/**',
    '**/__pycache__/**',
    '**/*.log',
    '**/*.sh',
    '**/*.py',
  ],
};
