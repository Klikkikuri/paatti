#!/usr/bin/env node
"use strict";

/**
 * @file devserver-server.mjs
 * The development server (karikko) as a child process: start, stop, and restart on the same port. The e2e
 * harness imports this module; the drift tool starts its server through the Makefile.
 *
 * The server command is the Makefile's `KARIKKO ?= uv run --directory packages/karikko karikko`, received as one
 * shell string through `KARIKKO`, overridable per call. This module owns no second flag catalogue: the caller
 * names the trailing arguments.
 */

import { spawn } from "node:child_process";
import net from "node:net";
import { isAbsolute, join, resolve } from "node:path";
import { repoRoot } from "./devserver-paths.mjs";

const DEFAULT_PROJECT_DIR = join(repoRoot, "packages", "karikko");
/** `uv run --directory` moves the server's working directory; the path in it must be absolute (see paths). */
const DEFAULT_COMMAND = `uv run --directory ${DEFAULT_PROJECT_DIR} karikko`;
/** Milliseconds: the readiness poll's total budget, period, and the SIGKILL escalation's grace. */
const READINESS_TIMEOUT = 30000;
const READINESS_INTERVAL = 200;
const STOP_TIMEOUT = 5000;
/** What the server prints when `freePort`'s released address was taken between release and bind. */
const ADDRESS_IN_USE = "in use";
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

/** @param {string} base @param {number} port @param {string} dataDir @param {string[]} flags
 * @returns {string} The one shell line this module runs: the command, then the quoted data directory, the port,
 * and the caller's flags. Single quotes around the path: a checkout below `~/My Projects/` must not split. */
function serverSpec(base, port, dataDir, flags) {
    return `${base} --data_dir='${dataDir}' --port=${port} ${flags.join(" ")}`.trimEnd();
}

/**
 * @typedef {object} ServerProcess
 * @property {import("node:child_process").ChildProcess} child
 * @property {() => Promise<void>} readiness - Rejects when the child exits early or stays silent past the budget.
 * @property {() => string} logsOf
 */

/**
 * @param {string} spec
 * @param {number} port
 * @returns {ServerProcess}
 */
function startProcess(spec, port) {
    // Detached: the whole group behind the shell string is this handle's, and a group signal reaches uv's child.
    const child = spawn(spec, { shell: true, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const logs = [];
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

function onceExit(child) {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise((resolvePromise) => child.once("exit", resolvePromise));
}

/**
 * Signals the whole group behind the shell string; ESRCH-safe, so a repeat signal is a no-op.
 */
function signalGroup(child, signal) {
    if (child.pid === undefined) return;
    for (const target of [-child.pid, child.pid]) {
        try {
            process.kill(target, signal);
        } catch {
            // Gone already; that is what a poll expects.
        }
    }
}

/**
 * SIGTERM to the group first, then SIGKILL after the grace period. uvicorn turns SIGTERM into a graceful
 * shutdown that can outlive its shell, so the shell's exit says nothing, and neither does the child's `exitCode`:
 * the group is what a stop owns, and it stops only when killing it answers ESRCH.
 */
async function stopGroup(child, logsOf) {
    signalGroup(child, "SIGTERM");
    await onceExit(child);
    const deadline = Date.now() + STOP_TIMEOUT;
    for (;;) {
        let gone;
        try {
            process.kill(-child.pid, "SIGKILL");
        } catch (error) {
            if (error.code !== "ESRCH") throw error;
            return;
        }
        gone = Date.now() > deadline;
        if (gone) throw new Error(`the server process group refused to die:\n${logsOf()}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

/**
 * @typedef {object} ServerHandle
 * @property {number} port
 * @property {() => string} logs - What the current child printed (tail-bounded), for a failure report.
 * @property {() => Promise<void>} stop - Idempotent; safe to call from an unconditional `afterEach`.
 * @property {(flags?: string[]) => Promise<void>} restart - Stops the current child, then spawns again on the
 *   same port and data directory with the new flags. The handle stays this handle; the caller keeps nothing
 *   else alive and nothing stale. Also invoked by every start with the base flags once.
 */

/**
 * The handle object is stable across restarts; a caller that kept it holds the live one.
 *
 * @param {number} port
 * @param {string} dataDir
 * @param {ServerProcess} initial
 * @param {string} base
 * @param {string[]} startupFlags
 * @returns {ServerHandle}
 */
function createHandle(port, dataDir, initial, base, startupFlags) {
    let current = initial;
    let currentFlags = startupFlags;

    async function stop() {
        await stopGroup(current.child, current.logsOf);
    }

    async function spawnProcess() {
        const fresh = startProcess(serverSpec(base, port, dataDir, currentFlags), port);
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
        restart: async (flags = currentFlags) => {
            currentFlags = flags;
            await handle.stop();
            await spawnProcess();
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
 * @param {string} [options.command] - Overrides `KARIKKO`, then the submodule default; the whole shell string.
 * @returns {Promise<ServerHandle>}
 */
export async function startServer({ dataDir, flags = [], port, command } = {}) {
    if (dataDir === undefined) throw new Error("startServer: no data directory");
    if (!isAbsolute(dataDir)) dataDir = resolve(dataDir);
    port ??= await freePort();
    const base = command ?? process.env.KARIKKO ?? DEFAULT_COMMAND;

    let failure;
    for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
        const spec = serverSpec(base, port, dataDir, flags);
        const proc = startProcess(spec, port);
        try {
            await proc.readiness();
            return createHandle(port, dataDir, proc, base, flags);
        } catch (error) {
            failure = error;
            await stopGroup(proc.child, proc.logsOf);
            if (!proc.logsOf().includes(ADDRESS_IN_USE)) break;
            port = await freePort();
        }
    }
    throw failure;
}
