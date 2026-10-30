#!/usr/bin/env node
"use strict";

/**
 * @file devserver-server.mjs
 * The development server (karikko) as a child process: start, stop, and restart on the same port. The e2e
 * harness and the Makefile import this module; it is the only owner of the server lifecycle.
 *
 * The command is built here from `KARIKKO_DIR` (default: `packages/karikko`), so the repository keeps one
 * definition of it. uv syncs the project environment on the first run, which a fresh checkout and the CI image
 * both need; a caller may still pass a whole argv array (`command`) to drive something else. This module owns no
 * second flag catalogue: the caller names the trailing arguments.
 */

import { spawn } from "node:child_process";
import net from "node:net";
import { isAbsolute, join, resolve } from "node:path";
import { repoRoot } from "./devserver-paths.mjs";

/** The command line of the server, built from KARIKKO_DIR so the repository keeps one definition. */
const defaultCommand = () => {
    const dir = join(repoRoot, process.env.KARIKKO_DIR ?? "packages/karikko");
    return ["uv", "run", "--directory", dir, "karikko"];
};
/** Milliseconds: the readiness poll's total budget and period, and the SIGTERM grace before SIGKILL. */
const READINESS_TIMEOUT = 30000;
const READINESS_INTERVAL = 200;
const STOP_TIMEOUT = 5000;
/** How long the group gets to die after SIGKILL before the stop reports a failure. */
const KILL_WAIT = 2000;
const PORT_ATTEMPTS = 3;

/** Resolves the readiness URL's answer: the server's `/` needs no provider, so it answers before its manifests. */
function singleUrlProbe(url) {
    return fetch(url).then((response) => response.ok);
}

/** @returns {Promise<number>} A port that is free now; the bind race with a later spawn is `startServer`'s. */
export function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

/** @param {string[]} command @param {number} port @param {string} dataDir @param {string[]} flags
 * @returns {string[]} The full argv this module spawns: the command, then the data directory, the port, and the
 *   caller's flags. An array, so a checkout below `~/My Projects/` needs no quoting to survive. */
function serverArgv(command, port, dataDir, flags) {
    return [...command, `--data_dir=${dataDir}`, `--port=${port}`, ...flags];
}

/**
 * @typedef {object} ServerProcess
 * @property {import("node:child_process").ChildProcess} child
 * @property {() => Promise<void>} readiness - Rejects when the child exits early or stays silent past the budget.
 * @property {() => string} logsOf
 */

/**
 * @param {string[]} argv
 * @param {number} port
 * @returns {ServerProcess}
 */
function startProcess(argv, port) {
    // Detached: the whole process group is this handle's, and a group signal reaches uv's child. No shell:
    // the argv array is the command, so nothing re-parses a path.
    const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const logs = [];
    // A failed exec (no `uv` on PATH) arrives as an error event after the pipes are set; without a listener it
    // would crash the caller with an unhandled 'error'. The readiness poll reports the exit instead.
    child.on("error", (error) => logs.push(`${error.message}\n`));
    const collect = (text) => {
        logs.push(text);
        if (logs.length > 200) logs.splice(0, logs.length - 100);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    const readiness = () => {
        // `127.0.0.1` is what the server binds; `localhost` is the page-level contract, not the probe's.
        const url = `http://127.0.0.1:${port}/`;
        const started = Date.now();
        return new Promise((resolveReady, rejectReady) => {
            let settled = false;
            const finish = (error) => {
                if (settled) return;
                settled = true;
                clearInterval(timer);
                error === undefined ? resolveReady() : rejectReady(error);
            };
            const timer = setInterval(() => {
                if (child.exitCode !== null || child.signalCode !== null) {
                    finish(new Error(`the server exited while starting:\n${logs.join("")}`));
                } else if (Date.now() - started > READINESS_TIMEOUT) {
                    finish(new Error(`the server did not answer within ${READINESS_TIMEOUT} ms:\n${logs.join("")}`));
                } else {
                    singleUrlProbe(url).then((ok) => ok && finish()).catch(() => {
                        // Not listening yet: that is what a poll expects.
                    });
                }
            }, READINESS_INTERVAL);
        });
    };

    return { child, readiness, logsOf: () => logs.join("") };
}

/** Whether anything accepts a TCP connection on `port`: another server took it under us. A connect says exactly
 * that, where a fetch would also depend on what the other server answers and how fast. */
function portTaken(port) {
    return new Promise((resolveTaken) => {
        const socket = net.connect({ port, host: "127.0.0.1" });
        const done = (taken) => {
            socket.destroy();
            resolveTaken(taken);
        };
        socket.setTimeout(1000);
        socket.once("connect", () => done(true));
        socket.once("timeout", () => done(false));
        socket.once("error", () => done(false));
    });
}

/** Whether the process group still exists: signal 0 answers ESRCH once every member is gone. */
function groupAlive(pid) {
    try {
        process.kill(-pid, 0);
        return true;
    } catch (error) {
        if (error.code === "ESRCH") return false;
        throw error;
    }
}

async function waitForGroupDeath(child, timeoutMs, logsOf) {
    const deadline = Date.now() + timeoutMs;
    while (groupAlive(child.pid)) {
        if (Date.now() > deadline) throw new Error(`the server process group refused to die:\n${logsOf()}`);
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
}

/**
 * SIGTERM to the group, then a grace period for uvicorn's own shutdown, then one SIGKILL. The group is what a stop
 * owns: it stops only when polling it answers ESRCH, which also covers the child itself, so no separate wait for
 * the child's exit is needed — that wait would never end for a child that ignores SIGTERM, and the escalation
 * would never be reached. No repeat SIGKILL inside the poll: the first one kills every surviving member, and a
 * later failure would mean the pid was reused by an unrelated group.
 */
async function stopGroup(child, logsOf) {
    if (child.pid === undefined) return; // The exec failed, so there is no process group to stop.
    try {
        process.kill(-child.pid, "SIGTERM");
    } catch {
        // Gone already; that is what a poll expects.
    }
    try {
        await waitForGroupDeath(child, STOP_TIMEOUT, logsOf);
        return;
    } catch {
        // Past the grace period: escalate below. The error of the poll is the answer only if the kill fails too.
    }
    try {
        process.kill(-child.pid, "SIGKILL");
    } catch {
        return; // The group died between the last poll and the kill.
    }
    await waitForGroupDeath(child, KILL_WAIT, logsOf);
}

/**
 * @typedef {object} ServerHandle
 * @property {number} port
 * @property {() => string} logs - What the current child printed (tail-bounded), for a failure report.
 * @property {() => Promise<void>} stop - Idempotent; safe to call from an unconditional `afterEach`.
 * @property {(flags: string[]) => Promise<void>} restart - Stops the current child, then spawns again on the
 *   same port and data directory with these flags. The flags are required: one call means exactly one thing.
 *   The handle stays this handle; the caller keeps nothing else alive and nothing stale.
 */

/**
 * The handle object is stable across restarts; a caller that kept it holds the live one.
 *
 * @param {number} port
 * @param {string} dataDir
 * @param {ServerProcess} initial
 * @param {string[]} command
 * @returns {ServerHandle}
 */
function createHandle(port, dataDir, initial, command) {
    let current = initial;

    async function stop() {
        await stopGroup(current.child, current.logsOf);
    }

    async function spawnProcess(flags) {
        const fresh = startProcess(serverArgv(command, port, dataDir, flags), port);
        try {
            await fresh.readiness();
        } catch (error) {
            await stopGroup(fresh.child, fresh.logsOf);
            throw error;
        }
        current = fresh;
    }

    /** @type {ServerHandle} */
    const handle = {
        port,
        logs: () => current.logsOf(),
        stop,
        restart: async (flags) => {
            if (!Array.isArray(flags)) throw new Error("restart: the flags array is required");
            await handle.stop();
            await spawnProcess(flags);
        },
    };
    return handle;
}

/**
 * Starts the server and waits until it answers.
 *
 * @param {object} options
 * @param {string} options.dataDir - Directory for the server's captures. Relative is fine: this module makes it
 *   absolute, because the server's cwd is the project's, not the caller's.
 * @param {string[]} [options.flags] - Trailing karikko arguments, already formed by the caller.
 * @param {number} [options.port] - Defaults to `freePort()`.
 * @param {string[]} [options.command] - Overrides the default `uv run --directory <KARIKKO_DIR> karikko`; the
 *   whole argv, no shell.
 * @returns {Promise<ServerHandle>}
 */
export async function startServer({ dataDir, flags = [], port, command } = {}) {
    if (dataDir === undefined) throw new Error("startServer: no data directory");
    if (!isAbsolute(dataDir)) dataDir = resolve(dataDir);
    port ??= await freePort();
    const argv0 = command ?? defaultCommand();

    let failure;
    for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
        const proc = startProcess(serverArgv(argv0, port, dataDir, flags), port);
        try {
            await proc.readiness();
            return createHandle(port, dataDir, proc, argv0);
        } catch (error) {
            failure = error;
            await stopGroup(proc.child, proc.logsOf);
            // A port that something else answers on was taken between freePort() and the bind: try another one.
            // Any other failure (a broken command, a bad flag) would fail again on a new port, so stop there.
            if (!await portTaken(port)) break;
            port = await freePort();
        }
    }
    throw failure;
}
