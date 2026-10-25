// ==UserScript==
// @name         Miniblox - F3 Extension
// @namespace    BOT aka @l0calHosT
// @version      2.24
// @description  Minecraft-style F3 extensions for Miniblox
// @match        https://miniblox.io/*
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

const wireframeSettings = { enabled: false };

function installWireframeHook() {
    const contexts = [];
    if (typeof WebGLRenderingContext !== "undefined") contexts.push(WebGLRenderingContext.prototype);
    if (typeof WebGL2RenderingContext !== "undefined" && WebGL2RenderingContext.prototype !== WebGLRenderingContext?.prototype) {
        contexts.push(WebGL2RenderingContext.prototype);
    }

    for (const WebGL of contexts) {
        for (const method of ["drawElements", "drawElementsInstanced"]) {
            const original = WebGL[method];
            if (typeof original !== "function" || original.__mbF3WireframeHook) continue;

            const wrapped = new Proxy(original, {
                apply(target, thisArgs, args) {
                    try {
                        if (wireframeSettings.enabled) {
                            const program = thisArgs.getParameter(thisArgs.CURRENT_PROGRAM);
                            if (program && !program.isUIProgram && Number(args[1]) > 6) {
                                args[0] = thisArgs.LINES;
                            }
                        }
                    } catch (error) {
                        console.error("[MB F3] Wireframe draw hook failed:", error);
                    }
                    return Reflect.apply(target, thisArgs, args);
                }
            });
            wrapped.__mbF3WireframeHook = true;
            WebGL[method] = wrapped;
        }
    }
}

installWireframeHook();

function toggleWireframe() {
    wireframeSettings.enabled = !wireframeSettings.enabled;

    return wireframeSettings.enabled;
}

(async () => {
    "use strict";

    let game = null;
    let gameModule = null;
    let threeModule = null;

    let f3Down = false;
    let f3WasPressed = false;
    let f3ComboUsed = false;

    let chunkBordersEnabled = false;
    let chunkBorderRoot = null;

    let chunkBorderLastX = null;
    let chunkBorderLastY = null;
    let chunkBorderLastZ = null;

    let cHoldTimer = null;
    let cHolding = false;

    let f3PreviousGamemode = null;
    let f3TargetController = null;

    let gamemodeMenuOpen = false;
    let gamemodeMenuIndex = 0;
    let gamemodeMenuRoot = null;
    let gamemodeOriginalMode = null;
    let gamemodePendingMode = null;
    let lastF4Press = false;

    let performanceRecording = false;
    let performanceRecordingStartedAt = 0;
    let performanceRecordingTimer = null;
    let performanceRecordingRAF = 0;
    let performanceRecordingSamples = [];
    let performanceRecordingFrames = [];
    let performanceRecordingLongTasks = [];
    let performanceRecordingEventLoopSamples = [];
    let performanceRecordingRenderer = null;
    let performanceRecordingObserver = null;
    let performanceRecordingLastFrame = 0;
    let performanceRecordingFrameCount = 0;
    let performanceRecordingStartMemory = null;

    const GAMEMODE_OPTIONS = [
        {
            id: "survival",
            name: "Survival Mode",
            icon: "iron_sword"
        },
        {
            id: "creative",
            name: "Creative Mode",
            icon: "grass_block"
        },
        {
            id: "adventure",
            name: "Adventure Mode",
            icon: "map"
        },
        {
            id: "spectator",
            name: "Spectator Mode",
            icon: "ender_eye"
        }
    ];

    function chatMessage(message, color = "white") {
        try {
            const chat = game?.chat;

            if (!chat || typeof chat.addChat !== "function") {

                return false;
            }

            chat.addChat({
                text: String(message).replace(/§[0-9a-fk-or]/gi, ""),
                color
            });

            return true;

        } catch (error) {
            console.error(
                "[MB F3] Chat message failed:",
                error
            );

            return false;
        }
    }

    function findGameScript() {
        return [...document.scripts].find(script => {
            if (!script.src) return false;

            try {
                const url = new URL(script.src);

                return (
                    url.pathname.startsWith("/assets/index-") &&
                    url.pathname.endsWith(".js") &&
                    script.type === "module"
                );
            } catch {
                return false;
            }
        });
    }

    const gameScript = findGameScript();

    if (!gameScript) {

        return;
    }

    try {
        gameModule = await import(gameScript.src);
    } catch (error) {
        console.error("[MB F3] Game import failed:", error);
        return;
    }

    function findGameFromExports() {
        for (const value of Object.values(gameModule)) {
            try {
                if (
                    value !== null &&
                    typeof value === "object" &&
                    "gameScene" in value &&
                    "GameSceneClass" in value &&
                    "player" in value &&
                    "world" in value
                ) {
                    return value;
                }
            } catch {}
        }

        return null;
    }

    game = findGameFromExports();

    if (!game) {
        try {
            const element = document.querySelector("#react");
            const fiber = element && Object.values(element)[0];

            game =
                fiber?.updateQueue?.baseState?.element?.props?.game ??
                null;
        } catch {}
    }

    if (!game) {

        return;
    }

    let world = null;
    let player = null;
    let camera = null;

    async function waitForGameObjects() {
        for (let i = 0; i < 120; i++) {
            try {
                world = game.world;
                player = game.player;
                camera = game.gameScene?.camera;

                if (world && player && camera) {
                    return true;
                }
            } catch {}

            await new Promise(resolve =>
                setTimeout(resolve, 500)
            );
        }

        return false;
    }

    if (!(await waitForGameObjects())) {

        return;
    }

    unsafeWindow.Miniblox =
        unsafeWindow.Miniblox || {};

    unsafeWindow.Miniblox.game = game;
    unsafeWindow.Miniblox.gameModule = gameModule;

    Object.defineProperties(
        unsafeWindow.Miniblox,
        {
            world: {
                configurable: true,
                get() {
                    return game.world;
                }
            },

            player: {
                configurable: true,
                get() {
                    return game.player;
                }
            },

            camera: {
                configurable: true,
                get() {
                    return game.gameScene?.camera;
                }
            }
        }
    );

    function findThreeURL() {

        try {
            const resources =
                performance.getEntriesByType("resource");

            const threeResource = resources.find(entry => {
                try {
                    const url = new URL(entry.name);

                    return (
                        url.pathname.includes("/assets/three-") &&
                        url.pathname.endsWith(".js")
                    );
                } catch {
                    return false;
                }
            });

            if (threeResource) {
                return threeResource.name;
            }
        } catch {}

        for (const script of document.scripts) {
            if (!script.src) continue;

            try {
                const url = new URL(script.src);

                if (
                    url.pathname.includes("/assets/three-") &&
                    url.pathname.endsWith(".js")
                ) {
                    return script.src;
                }
            } catch {}
        }

        return location.origin +
            "/assets/three-D8Ud1rlT.js";
    }

    const threeURL = findThreeURL();

    try {
        threeModule = await import(threeURL);
    } catch (error) {
        console.error(
            "[MB F3] Three.js import failed:",
            error
        );

        return;
    }

    const ThreeGroup =
        threeModule.M;

    const ThreeBufferGeometry =
        threeModule.g;

    const ThreeFloat32BufferAttribute =
        threeModule.D;

    const ThreeLineBasicMaterial =
        threeModule.R;

    const ThreeLineSegments =
        threeModule.z;

    if (
        typeof ThreeGroup !== "function" ||
        typeof ThreeBufferGeometry !== "function" ||
        typeof ThreeFloat32BufferAttribute !== "function" ||
        typeof ThreeLineBasicMaterial !== "function" ||
        typeof ThreeLineSegments !== "function"
    ) {

        return;
    }

    function reloadChunks() {
        try {
            const manager =
                game.chunkRenderManager;

            if (
                !manager ||
                typeof manager.reload !== "function"
            ) {

                return false;
            }

            manager.reload();

            chatMessage(
                "[F3] Chunks reloaded"
            );

            return true;

        } catch (error) {
            console.error(
                "[MB F3] Chunk reload failed:",
                error
            );

            return false;
        }
    }

    unsafeWindow.Miniblox.reloadChunks =
        reloadChunks;

    function toggleHitboxes() {
        try {
            const settings =
                gameModule.$o;

            if (!settings) {

                return false;
            }

            settings.showHitboxes =
                !settings.showHitboxes;

            const state =
                settings.showHitboxes;

            chatMessage(
                `[F3] Entity Hitboxes: ${
                    state ? "ON" : "OFF"
                }`
            );

            return state;

        } catch (error) {
            console.error(
                "[MB F3] Hitbox toggle failed:",
                error
            );

            return false;
        }
    }

    unsafeWindow.Miniblox.toggleHitboxes =
        toggleHitboxes;

    async function copyPlayerCoords() {
        try {
            const p = game.player;

            if (!p?.pos) {

                return false;
            }

            const x = p.pos.x;
            const y = p.pos.y;
            const z = p.pos.z;

            const command =
                `/tp ${x} ${y} ${z}`;

            await navigator.clipboard.writeText(
                command
            );

            chatMessage(
                `[F3] Copied: ${command}`
            );

            return true;

        } catch (error) {
            console.error(
                "[MB F3] Coordinate copy failed:",
                error
            );

            return false;
        }
    }

    unsafeWindow.Miniblox.copyPlayerCoords =
        copyPlayerCoords;

    function clearChat() {
        try {
            const chat = game.chat;

            if (
                !chat ||
                typeof chat.clear !== "function"
            ) {

                return false;
            }

            chat.clear();

            setTimeout(() => {
                chatMessage(
                    "[F3] Chat history cleared"
                );
            }, 0);

            return true;

        } catch (error) {
            console.error(
                "[MB F3] Failed to clear chat:",
                error
            );

            return false;
        }
    }

    unsafeWindow.Miniblox.clearChat =
        clearChat;

    function getPlayerPosition() {
        try {
            const p = game.player;

            if (!p?.pos) {
                return null;
            }

            return {
                x: Number(p.pos.x),
                y: Number(p.pos.y),
                z: Number(p.pos.z)
            };

        } catch {
            return null;
        }
    }

    function getChunkCoordinate(value) {
        return Math.floor(value / 16);
    }

    function findThreeConstructor(type, probeArgs = []) {
        for (const candidate of Object.values(threeModule || {})) {
            if (typeof candidate !== "function") continue;
            try {
                const probe = new candidate(...probeArgs);
                if (probe?.type === type) {
                    probe.dispose?.();
                    return candidate;
                }
                probe?.dispose?.();
            } catch {}
        }
        return null;
    }

    const ThreeCylinderGeometry = findThreeConstructor("CylinderGeometry", [1, 1, 1, 6, 1, false]);
    const ThreeMeshBasicMaterial = findThreeConstructor("MeshBasicMaterial", [{ color: 0xffffff }]);
    const ThreeMesh = findThreeConstructor("Mesh", [new ThreeBufferGeometry(), new ThreeLineBasicMaterial({ color: 0xffffff })]);

    function addThickSegments(root, vertices, color, radius, depthTest = false, renderOrder = 1002) {
        if (!ThreeCylinderGeometry || !ThreeMeshBasicMaterial || !ThreeMesh) {

            const geometry = new ThreeBufferGeometry();
            geometry.setAttribute("position", new ThreeFloat32BufferAttribute(vertices, 3));
            const material = new ThreeLineBasicMaterial({ color, depthTest, depthWrite: false, linewidth: 3 });
            const lines = new ThreeLineSegments(geometry, material);
            lines.renderOrder = renderOrder;
            lines.frustumCulled = false;
            root.add(lines);

            return;
        }

        const geometry = new ThreeCylinderGeometry(radius, radius, 1, 6, 1, false);
        const material = new ThreeMeshBasicMaterial({
            color, depthTest: false, depthWrite: false, transparent: false,
            toneMapped: false
        });

        for (let i = 0; i < vertices.length; i += 6) {
            const x1 = vertices[i], y1 = vertices[i + 1], z1 = vertices[i + 2];
            const x2 = vertices[i + 3], y2 = vertices[i + 4], z2 = vertices[i + 5];
            const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
            const length = Math.hypot(dx, dy, dz);
            if (!length) continue;

            const mesh = new ThreeMesh(geometry, material);
            mesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
            mesh.scale.set(1, length, 1);

            if (Math.abs(dx) > 0) mesh.rotation.z = -Math.PI / 2;
            else if (Math.abs(dz) > 0) mesh.rotation.x = Math.PI / 2;
            mesh.renderOrder = renderOrder;
            mesh.frustumCulled = false;
            root.add(mesh);
        }
    }

    const BORDER_HORIZONTAL_SPACING = 4;
    const BORDER_CORNER_GAP = 2;
    const BORDER_VERTICAL_OFFSETS = [2, 6, 10, 14];
    const BORDER_WORLD_MIN_Y = 0;
    const BORDER_WORLD_MAX_Y = 255;

    function removeChunkBorders() {
        try {
            if (!chunkBorderRoot) return;
            const scene = game.gameScene?.scene;
            if (scene) scene.remove(chunkBorderRoot);
            chunkBorderRoot.traverse(object => {
                object.geometry?.dispose?.();
                if (Array.isArray(object.material)) object.material.forEach(material => material?.dispose?.());
                else object.material?.dispose?.();
            });
            chunkBorderRoot = null;
            chunkBorderLastX = null;
            chunkBorderLastY = null;
            chunkBorderLastZ = null;

        } catch (error) {
            console.error("[MB F3] Failed removing chunk borders:", error);
        }
    }

    function pushSegment(vertices, x1, y1, z1, x2, y2, z2) {
        vertices.push(x1, y1, z1, x2, y2, z2);
    }

    function addChunkCubeEdges(vertices, minX, minY, minZ, maxX, maxY, maxZ) {
        for (const x of [minX, maxX]) {
            for (const z of [minZ, maxZ]) pushSegment(vertices, x, minY, z, x, maxY, z);
        }
        for (const y of [minY, maxY]) {
            pushSegment(vertices, minX, y, minZ, maxX, y, minZ);
            pushSegment(vertices, maxX, y, minZ, maxX, y, maxZ);
            pushSegment(vertices, maxX, y, maxZ, minX, y, maxZ);
            pushSegment(vertices, minX, y, maxZ, minX, y, minZ);
        }
    }

    function buildChunkBorders() {
        const scene = game.gameScene?.scene;
        if (!scene) {

            return false;
        }
        const pos = getPlayerPosition();
        if (!pos) {

            return false;
        }

        removeChunkBorders();
        const chunkX = getChunkCoordinate(pos.x);
        const chunkZ = getChunkCoordinate(pos.z);
        const sectionY = Math.floor(pos.y / 16);
        const blueMinY = sectionY * 16;
        const blueMaxY = blueMinY + 16;
        const minX = chunkX * 16, maxX = minX + 16;
        const minZ = chunkZ * 16, maxZ = minZ + 16;
        const root = new ThreeGroup();
        root.name = "MB_F3_ChunkBorders";

        const yellowVertices = [];
        const gap = BORDER_CORNER_GAP;
        for (let y = BORDER_WORLD_MIN_Y; y <= BORDER_WORLD_MAX_Y; y += BORDER_HORIZONTAL_SPACING) {

            pushSegment(yellowVertices, minX + gap, y, minZ, maxX - gap, y, minZ);
            pushSegment(yellowVertices, maxX, y, minZ + gap, maxX, y, maxZ - gap);
            pushSegment(yellowVertices, maxX - gap, y, maxZ, minX + gap, y, maxZ);
            pushSegment(yellowVertices, minX, y, maxZ - gap, minX, y, minZ + gap);

            pushSegment(yellowVertices, minX, y, minZ, minX + gap, y, minZ);
            pushSegment(yellowVertices, maxX - gap, y, minZ, maxX, y, minZ);
            pushSegment(yellowVertices, maxX, y, minZ, maxX, y, minZ + gap);
            pushSegment(yellowVertices, maxX, y, maxZ - gap, maxX, y, maxZ);
            pushSegment(yellowVertices, maxX, y, maxZ, maxX - gap, y, maxZ);
            pushSegment(yellowVertices, minX + gap, y, maxZ, minX, y, maxZ);
            pushSegment(yellowVertices, minX, y, maxZ, minX, y, maxZ - gap);
            pushSegment(yellowVertices, minX, y, minZ + gap, minX, y, minZ);
        }

        for (const offset of [4, 8, 12]) {
            const x = minX + offset;
            const z = minZ + offset;
            pushSegment(yellowVertices, x, BORDER_WORLD_MIN_Y, minZ, x, BORDER_WORLD_MAX_Y, minZ);
            pushSegment(yellowVertices, x, BORDER_WORLD_MIN_Y, maxZ, x, BORDER_WORLD_MAX_Y, maxZ);
            pushSegment(yellowVertices, minX, BORDER_WORLD_MIN_Y, z, minX, BORDER_WORLD_MAX_Y, z);
            pushSegment(yellowVertices, maxX, BORDER_WORLD_MIN_Y, z, maxX, BORDER_WORLD_MAX_Y, z);
        }
        addThickSegments(root, yellowVertices, 0xffff00, 0.45, true, 1005);

        const tealVertices = [];
        for (const offset of BORDER_VERTICAL_OFFSETS) {
            const x = minX + offset, z = minZ + offset;
            pushSegment(tealVertices, x, BORDER_WORLD_MIN_Y, minZ, x, BORDER_WORLD_MAX_Y, minZ);
            pushSegment(tealVertices, x, BORDER_WORLD_MIN_Y, maxZ, x, BORDER_WORLD_MAX_Y, maxZ);
            pushSegment(tealVertices, minX, BORDER_WORLD_MIN_Y, z, minX, BORDER_WORLD_MAX_Y, z);
            pushSegment(tealVertices, maxX, BORDER_WORLD_MIN_Y, z, maxX, BORDER_WORLD_MAX_Y, z);
        }
        addThickSegments(root, tealVertices, 0x20e0d0, 0.45, true, 1005);

        const blueVertices = [];
        addChunkCubeEdges(blueVertices, minX, blueMinY, minZ, maxX, blueMaxY, maxZ);
        addThickSegments(root, blueVertices, 0x168bff, 10, false, 1006);

        const redVertices = [];
        const redEdgeKeys = new Set();
        for (let cx = chunkX - 1; cx <= chunkX + 1; cx++) {
            for (let cz = chunkZ - 1; cz <= chunkZ + 1; cz++) {
                if (cx === chunkX && cz === chunkZ) continue;
                const x1 = cx * 16, x2 = x1 + 16, z1 = cz * 16, z2 = z1 + 16;
                for (const [x, z] of [
                    [x1, z1],
                    [x1, z2],
                    [x2, z1],
                    [x2, z2]
                ]) {

                    if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) continue;
                    const key = `${x},${z}`;
                    if (redEdgeKeys.has(key)) continue;
                    redEdgeKeys.add(key);
                    pushSegment(redVertices, x, BORDER_WORLD_MIN_Y, z, x, BORDER_WORLD_MAX_Y, z);
                }
            }
        }
        addThickSegments(root, redVertices, 0xff3030, 0.70, true, 1005);

        scene.add(root);
        chunkBorderRoot = root;
        chunkBorderLastX = chunkX;
        chunkBorderLastY = sectionY;
        chunkBorderLastZ = chunkZ;

        return true;
    }

    function updateChunkBorders() {
        if (!chunkBordersEnabled) return;
        const pos = getPlayerPosition();
        if (!pos) return;
        const chunkX = getChunkCoordinate(pos.x);
        const chunkZ = getChunkCoordinate(pos.z);
        const sectionY = Math.floor(pos.y / 16);
        if (!chunkBorderRoot || chunkX !== chunkBorderLastX || sectionY !== chunkBorderLastY || chunkZ !== chunkBorderLastZ) {
            buildChunkBorders();
        }
    }

    function findPerformanceRenderer() {
        if (performanceRecordingRenderer) {
            return performanceRecordingRenderer;
        }

        const candidates = [
            game?.gameScene?.renderer,
            game?.gameScene?.masterRenderer,
            game?.masterRenderer,
            game?.renderer
        ];

        for (const candidate of candidates) {
            if (candidate?.renderer?.info?.render) {
                performanceRecordingRenderer = candidate.renderer;
                return performanceRecordingRenderer;
            }

            if (candidate?.info?.render) {
                performanceRecordingRenderer = candidate;
                return performanceRecordingRenderer;
            }
        }

        try {
            const roots = [game?.gameScene, game];
            const seen = new Set();
            const queue = roots.filter(Boolean);

            while (queue.length && seen.size < 250) {
                const value = queue.shift();
                if (!value || (typeof value !== "object" && typeof value !== "function") || seen.has(value)) {
                    continue;
                }
                seen.add(value);

                try {
                    if (value?.info?.render && typeof value.render === "function") {
                        performanceRecordingRenderer = value;
                        return value;
                    }
                } catch {}

                for (const key of Object.keys(value).slice(0, 80)) {
                    try {
                        const child = value[key];
                        if (child && (typeof child === "object" || typeof child === "function")) {
                            queue.push(child);
                        }
                    } catch {}
                }
            }
        } catch {}

        return null;
    }

    function getPerformanceSnapshot() {
        const now = performance.now();
        const snapshot = {
            timeMs: Math.round(now - performanceRecordingStartedAt),
            timestamp: new Date().toISOString(),
            memory: {},
            rendering: {},
            world: {},
            timing: {}
        };

        try {
            const memory = performance.memory;
            if (memory) {
                snapshot.memory.usedJSHeapSize = memory.usedJSHeapSize;
                snapshot.memory.totalJSHeapSize = memory.totalJSHeapSize;
                snapshot.memory.jsHeapSizeLimit = memory.jsHeapSizeLimit;
            }
        } catch {}

        try {
            const renderer = findPerformanceRenderer();
            const info = renderer?.info;
            const render = info?.render;

            if (render) {
                snapshot.rendering.calls = Number(render.calls) || 0;
                snapshot.rendering.triangles = Number(render.triangles) || 0;
                snapshot.rendering.lines = Number(render.lines) || 0;
                snapshot.rendering.points = Number(render.points) || 0;
            }

            if (info?.memory) {
                snapshot.rendering.geometries = Number(info.memory.geometries) || 0;
                snapshot.rendering.textures = Number(info.memory.textures) || 0;
            }
        } catch {}

        try {
            const entities = game?.world?.entities;
            if (entities) {
                snapshot.world.entityCount =
                    typeof entities.size === "number" ? entities.size :
                    typeof entities.length === "number" ? entities.length :
                    Object.keys(entities).length;
            }
        } catch {}

        try {
            const player = game?.player;
            if (player?.pos) {
                snapshot.world.playerX = Number(player.pos.x) || 0;
                snapshot.world.playerY = Number(player.pos.y) || 0;
                snapshot.world.playerZ = Number(player.pos.z) || 0;
            }
        } catch {}

        snapshot.timing.frameCount = performanceRecordingFrameCount;

        return snapshot;
    }

    function performanceRecordingFrameLoop(timestamp) {
        if (!performanceRecording) return;

        if (performanceRecordingLastFrame > 0) {
            const delta = timestamp - performanceRecordingLastFrame;
            performanceRecordingFrames.push({
                timeMs: Math.round(timestamp - performanceRecordingStartedAt),
                frameMs: Number(delta.toFixed(3)),
                fps: delta > 0 ? Number((1000 / delta).toFixed(2)) : 0
            });
        }

        performanceRecordingLastFrame = timestamp;
        performanceRecordingFrameCount++;
        performanceRecordingRAF = requestAnimationFrame(performanceRecordingFrameLoop);
    }

    function recordPerformanceSample() {
        if (!performanceRecording) return;

        performanceRecordingSamples.push(getPerformanceSnapshot());

        const now = performance.now();
        if (performanceRecordingLastFrame > 0) {
            const elapsed = now - performanceRecordingLastFrame;
            if (elapsed > 100) {
                performanceRecordingEventLoopSamples.push({
                    timeMs: Math.round(now - performanceRecordingStartedAt),
                    delayMs: Number((elapsed - 50).toFixed(3))
                });
            }
        }

        performanceRecordingLastFrame = now;
    }

    function formatBytes(bytes) {
        if (!Number.isFinite(bytes)) return "N/A";
        if (bytes < 1024) return `${bytes.toFixed(0)} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
        return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
    }

    function buildPerformanceReport() {
        const duration = performanceRecordingStartedAt
            ? ((performance.now() - performanceRecordingStartedAt) / 1000)
            : 0;

        const lines = [];
        const divider = "=".repeat(78);

        lines.push(divider);
        lines.push("MINIBLOX PERFORMANCE PROFILE");
        lines.push(divider);
        lines.push(`Started : ${new Date(Date.now() - duration * 1000).toISOString()}`);
        lines.push(`Ended   : ${new Date().toISOString()}`);
        lines.push(`Duration: ${duration.toFixed(3)} seconds`);
        lines.push(`Frames  : ${performanceRecordingFrameCount}`);
        lines.push("");

        lines.push("[MEMORY]");
        const memorySamples = performanceRecordingSamples.filter(s => s.memory?.usedJSHeapSize);
        if (memorySamples.length) {
            const used = memorySamples.map(s => s.memory.usedJSHeapSize);
            const total = memorySamples.map(s => s.memory.totalJSHeapSize).filter(Number.isFinite);
            const limit = memorySamples.map(s => s.memory.jsHeapSizeLimit).filter(Number.isFinite);
            lines.push(`Samples          : ${memorySamples.length}`);
            lines.push(`Start heap       : ${formatBytes(used[0])}`);
            lines.push(`End heap         : ${formatBytes(used[used.length - 1])}`);
            lines.push(`Minimum heap     : ${formatBytes(Math.min(...used))}`);
            lines.push(`Maximum heap     : ${formatBytes(Math.max(...used))}`);
            if (total.length) lines.push(`Latest total heap: ${formatBytes(total[total.length - 1])}`);
            if (limit.length) lines.push(`Heap limit       : ${formatBytes(limit[limit.length - 1])}`);
        } else {
            lines.push("performance.memory is unavailable in this browser.");
        }
        lines.push("");

        lines.push("[RENDERING]");
        const renderSamples = performanceRecordingSamples.filter(s => s.rendering && Object.keys(s.rendering).length);
        if (renderSamples.length) {
            const last = renderSamples[renderSamples.length - 1].rendering;
            const maxCalls = Math.max(...renderSamples.map(s => s.rendering.calls ?? 0));
            const maxTriangles = Math.max(...renderSamples.map(s => s.rendering.triangles ?? 0));
            lines.push(`Latest draw calls: ${last.calls ?? "N/A"}`);
            lines.push(`Peak draw calls  : ${maxCalls}`);
            lines.push(`Latest triangles : ${last.triangles ?? "N/A"}`);
            lines.push(`Peak triangles   : ${maxTriangles}`);
            lines.push(`Latest lines     : ${last.lines ?? "N/A"}`);
            lines.push(`Latest points    : ${last.points ?? "N/A"}`);
            lines.push(`Geometries       : ${last.geometries ?? "N/A"}`);
            lines.push(`Textures         : ${last.textures ?? "N/A"}`);
        } else {
            lines.push("Three.js renderer statistics were unavailable.");
        }
        lines.push("");

        lines.push("[FRAME TIMES]");
        if (performanceRecordingFrames.length) {
            const frames = performanceRecordingFrames.map(f => f.frameMs).filter(v => v > 0);
            const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
            const min = Math.min(...frames);
            const max = Math.max(...frames);
            const fps = frames.length / Math.max(duration, 0.001);
            lines.push(`Average frame time: ${avg.toFixed(3)} ms`);
            lines.push(`Minimum frame time: ${min.toFixed(3)} ms`);
            lines.push(`Maximum frame time: ${max.toFixed(3)} ms`);
            lines.push(`Average FPS       : ${fps.toFixed(2)}`);
            lines.push("");
            lines.push("time_ms,frame_ms,fps");
            for (const frame of performanceRecordingFrames) {
                lines.push(`${frame.timeMs},${frame.frameMs},${frame.fps}`);
            }
        } else {
            lines.push("No frame samples recorded.");
        }
        lines.push("");

        lines.push("[EVENT LOOP]");
        lines.push("Measured using a 50 ms scheduler interval; this is event-loop delay, not an exact game tick duration.");
        if (performanceRecordingEventLoopSamples.length) {
            lines.push("time_ms,delay_ms");
            for (const sample of performanceRecordingEventLoopSamples) {
                lines.push(`${sample.timeMs},${sample.delayMs}`);
            }
        } else {
            lines.push("No significant event-loop delays (>100 ms interval) were observed.");
        }
        lines.push("");

        lines.push("[WORLD]");
        const worldSamples = performanceRecordingSamples.filter(s => s.world);
        if (worldSamples.length) {
            const counts = worldSamples.map(s => s.world.entityCount).filter(Number.isFinite);
            lines.push(`Latest entity count: ${counts.length ? counts[counts.length - 1] : "N/A"}`);
            if (counts.length) lines.push(`Peak entity count  : ${Math.max(...counts)}`);
        }
        lines.push("");

        lines.push("[SAMPLES]");
        lines.push("time_ms,heap_used_bytes,draw_calls,triangles,geometries,textures,entity_count");
        for (const sample of performanceRecordingSamples) {
            lines.push([
                sample.timeMs,
                sample.memory?.usedJSHeapSize ?? "",
                sample.rendering?.calls ?? "",
                sample.rendering?.triangles ?? "",
                sample.rendering?.geometries ?? "",
                sample.rendering?.textures ?? "",
                sample.world?.entityCount ?? ""
            ].join(","));
        }

        lines.push("");
        lines.push(divider);
        lines.push("End of Miniblox performance profile");
        lines.push(divider);

        return lines.join("\n");
    }

    function downloadPerformanceReport() {
        const report = buildPerformanceReport();
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
        const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `miniblox-profiling-${stamp}.txt`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return report;
    }

    function stopPerformanceRecording(download = true) {
        if (!performanceRecording) return false;

        performanceRecording = false;

        if (performanceRecordingTimer) {
            clearInterval(performanceRecordingTimer);
            performanceRecordingTimer = null;
        }

        if (performanceRecordingRAF) {
            cancelAnimationFrame(performanceRecordingRAF);
            performanceRecordingRAF = 0;
        }

        if (performanceRecordingObserver) {
            try { performanceRecordingObserver.disconnect(); } catch {}
            performanceRecordingObserver = null;
        }

        if (download) {
            downloadPerformanceReport();
        }

        chatMessage("[F3] Performance recording stopped — report downloaded", "white");

        return true;
    }

    function startPerformanceRecording() {
        if (performanceRecording) return false;

        performanceRecording = true;
        performanceRecordingStartedAt = performance.now();
        performanceRecordingSamples = [];
        performanceRecordingFrames = [];
        performanceRecordingLongTasks = [];
        performanceRecordingEventLoopSamples = [];
        performanceRecordingRenderer = null;
        performanceRecordingLastFrame = 0;
        performanceRecordingFrameCount = 0;
        performanceRecordingStartMemory = performance.memory ? performance.memory.usedJSHeapSize : null;

        try {
            if (typeof PerformanceObserver === "function") {
                performanceRecordingObserver = new PerformanceObserver(list => {
                    if (!performanceRecording) return;
                    for (const entry of list.getEntries()) {
                        performanceRecordingLongTasks.push({
                            timeMs: Number((entry.startTime - performanceRecordingStartedAt).toFixed(3)),
                            durationMs: Number(entry.duration.toFixed(3))
                        });
                    }
                });
                performanceRecordingObserver.observe({ type: "longtask", buffered: false });
            }
        } catch {}

        performanceRecordingTimer = setInterval(recordPerformanceSample, 250);
        performanceRecordingRAF = requestAnimationFrame(performanceRecordingFrameLoop);
        recordPerformanceSample();

        setTimeout(() => {
            if (performanceRecording) {
                stopPerformanceRecording(true);
            }
        }, 10000);

        chatMessage("[F3] Performance recording started (10 seconds max)", "white");

        return true;
    }

    function togglePerformanceRecording() {
        if (performanceRecording) {
            stopPerformanceRecording(true);
        } else {
            startPerformanceRecording();
        }
    }

    function findGuiToastURL() {
        try {
            const resources =
                performance.getEntriesByType("resource");

            const resource = resources.find(entry => {
                try {
                    const url = new URL(entry.name);
                    return (
                        url.pathname.includes("/assets/GuiToast-") &&
                        url.pathname.endsWith(".js")
                    );
                } catch {
                    return false;
                }
            });

            if (resource) return resource.name;
        } catch {}

        for (const script of document.scripts) {
            if (!script.src) continue;
            try {
                const url = new URL(script.src);
                if (
                    url.pathname.includes("/assets/GuiToast-") &&
                    url.pathname.endsWith(".js")
                ) {
                    return script.src;
                }
            } catch {}
        }

        return null;
    }

    async function findNativeClientVersion() {
        try {
            const guiToastURL = findGuiToastURL();

            if (guiToastURL) {
                const guiToastModule =
                    await import(guiToastURL);

                const version =
                    guiToastModule?.Ar;

                if (
                    version !== undefined &&
                    version !== null &&
                    version !== ""
                ) {
                    return String(version);
                }
            }
        } catch (error) {

        }

        try {
            const source = await fetch(gameScript.src, {
                credentials: "include"
            }).then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.text();
            });

            const match =
                source.match(/S=`(\d+\.\d+\.\d+)`,C=`(production|staging|development|local)`/);

            if (match) {
                return match[1];
            }
        } catch (error) {

        }

        return null;
    }

    function findVersionObject(value, seen = new Set(), depth = 0) {
        if (!value || depth > 3 || seen.has(value)) {
            return null;
        }

        const type = typeof value;
        if (type !== "object" && type !== "function") {
            return null;
        }

        seen.add(value);

        try {
            const keys = Object.keys(value);
            const versionKeys = [
                "version",
                "clientVersion",
                "gameVersion",
                "buildVersion"
            ];

            for (const key of versionKeys) {
                const candidate = value[key];
                if (candidate && typeof candidate === "object") {
                    const candidateKeys = Object.keys(candidate);
                    if (candidateKeys.some(k =>
                        /id|name|data.?version|protocol|series|build|stable|pack/i.test(k)
                    )) {
                        return candidate;
                    }
                }
            }

            for (const key of keys.slice(0, 100)) {
                try {
                    const child = value[key];
                    if (!child || (typeof child !== "object" && typeof child !== "function")) {
                        continue;
                    }

                    const result = findVersionObject(child, seen, depth + 1);
                    if (result) return result;
                } catch {}
            }
        } catch {}

        return null;
    }

    function versionField(source, ...keys) {
        if (!source || typeof source !== "object") return null;

        for (const key of keys) {
            try {
                if (
                    source[key] !== undefined &&
                    source[key] !== null &&
                    source[key] !== ""
                ) {
                    return source[key];
                }
            } catch {}
        }

        return null;
    }

    function formatVersionValue(value) {
        if (value === undefined || value === null || value === "") {
            return "N/A";
        }

        if (typeof value === "object") {
            try {
                return JSON.stringify(value);
            } catch {
                return String(value);
            }
        }

        return String(value);
    }

    async function requestLatestClientVersion() {
        try {
            const response = await fetch("/version/latest_client", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: "{}",
                credentials: "include"
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            return await response.json();
        } catch (error) {

            return null;
        }
    }

    async function dumpVersionInfo() {
        const scriptUrl = gameScript?.src ?? "N/A";
        const scriptName = scriptUrl !== "N/A"
            ? scriptUrl.split("/").pop()
            : "N/A";

        const endpointData = await requestLatestClientVersion();
        const nativeClientVersion =
            await findNativeClientVersion();
        const moduleVersion = findVersionObject(gameModule);

        const endpointVersion =
            typeof endpointData?.version === "string"
                ? endpointData.version
                : null;

        const versionObject =
            endpointData?.version &&
            typeof endpointData.version === "object"
                ? endpointData.version
                : endpointData &&
                    typeof endpointData === "object"
                    ? endpointData
                    : moduleVersion;

        const clientVersion =
            nativeClientVersion ??
            endpointVersion ??
            versionField(
                versionObject,
                "version", "clientVersion", "gameVersion"
            );

        const id = versionField(
            versionObject,
            "id", "versionId", "version_id", "buildId", "build_id"
        ) ?? clientVersion;

        const name = versionField(
            versionObject,
            "name", "version", "clientVersion", "gameVersion"
        ) ?? clientVersion;

        const dataVersion = versionField(
            versionObject,
            "dataVersion", "data_version"
        );

        const series = versionField(
            versionObject,
            "series", "versionSeries"
        );

        const protocolVersion = versionField(
            versionObject,
            "protocolVersion", "protocol_version", "protocol"
        );

        const buildTime = versionField(
            versionObject,
            "buildTime", "build_time", "builtAt", "built_at"
        );

        const resourcePackFormat = versionField(
            versionObject,
            "resourcePackFormat", "resource_pack_format",
            "resourceFormat", "resource_format"
        );

        const dataPackFormat = versionField(
            versionObject,
            "dataPackFormat", "data_pack_format",
            "dataFormat", "data_format"
        );

        const packFormat = versionField(
            versionObject,
            "packFormat", "pack_format"
        );

        const stable = versionField(
            versionObject,
            "stable", "isStable", "is_stable"
        );

        const lines = [
            "[F3] Version Information",
            `ID: ${formatVersionValue(id)}`,
            `Name: ${formatVersionValue(name)}`,
            `Data Version: ${formatVersionValue(dataVersion)}`,
            `Series: ${formatVersionValue(series)}`,
            `Protocol Version: ${formatVersionValue(protocolVersion)}`,
            `Build Time: ${formatVersionValue(buildTime)}`,
            `Resource Pack Format: ${formatVersionValue(resourcePackFormat)}`,
            `Data Pack Format: ${formatVersionValue(dataPackFormat)}`,
            `Pack Format: ${formatVersionValue(packFormat)}`,
            `Stable: ${formatVersionValue(stable)}`,
            `Client Version: ${formatVersionValue(clientVersion)}`,
            `Client Script: ${scriptName}`,
            `Client Script URL: ${scriptUrl}`
        ];

        for (const line of lines) {
            chatMessage(line);
        }

        const dump = lines.join("\n");

        try {
            await navigator.clipboard.writeText(dump);
            chatMessage(
                "[F3] Version information copied to clipboard",
                "green"
            );
        } catch (error) {

            chatMessage(
                "[F3] Could not copy version information to clipboard",
                "white"
            );
        }

        return dump;
    }

    unsafeWindow.Miniblox.dumpVersionInfo =
        dumpVersionInfo;

    function toggleChunkBorders() {
        chunkBordersEnabled =
            !chunkBordersEnabled;

        if (chunkBordersEnabled) {
            const success =
                buildChunkBorders();

            if (!success) {
                chunkBordersEnabled = false;

                chatMessage(
                    "[F3] Chunk Borders: FAILED",
                    "red"
                );

                return false;
            }

            chatMessage(
                "[F3] Chunk Borders: ON",
                "green"
            );

            return true;
        }

        removeChunkBorders();

        chatMessage(
            "[F3] Chunk Borders: OFF",
            "red"
        );

        return false;
    }

    unsafeWindow.Miniblox.toggleChunkBorders =
        toggleChunkBorders;

    unsafeWindow.Miniblox.removeChunkBorders =
        removeChunkBorders;

    function getCurrentGamemode() {
        try {
            const p = game?.player;
            const mode =
                p?.mode ??
                p?.gameMode ??
                p?.gamemode ??
                null;

            if (typeof mode === "string") {
                return mode.toLowerCase();
            }

            if (mode?.id != null) {
                return String(mode.id).toLowerCase();
            }

            if (typeof mode?.toId === "function") {
                return String(mode.toId()).toLowerCase();
            }

            if (typeof mode?.toString === "function") {
                const value = String(mode.toString()).toLowerCase();
                if (GAMEMODE_OPTIONS.some(option => option.id === value)) {
                    return value;
                }
            }
        } catch (error) {
            console.error("[MB F3] Could not read gamemode:", error);
        }

        return "survival";
    }

    function findSPacketMessageClass() {
        try {
            const direct =
                unsafeWindow.Miniblox?.SPacketMessage ??
                unsafeWindow.SPacketMessage;

            if (
                typeof direct === "function" &&
                direct.typeName === "SPacketMessage"
            ) {
                return direct;
            }

            for (const value of Object.values(gameModule ?? {})) {
                if (
                    typeof value === "function" &&
                    value.typeName === "SPacketMessage"
                ) {
                    return value;
                }
            }
        } catch {}

        return null;
    }

    function findClientSocketClass() {
        try {
            const direct =
                unsafeWindow.Miniblox?.ClientSocket ??
                unsafeWindow.ClientSocket;

            if (
                direct &&
                typeof direct.sendPacket === "function"
            ) {
                return direct;
            }

            for (const value of Object.values(gameModule ?? {})) {
                if (
                    value &&
                    typeof value === "function" &&
                    typeof value.sendPacket === "function"
                ) {
                    return value;
                }
            }
        } catch {}

        return null;
    }

    function sendGamemodePacket(mode) {
        try {
            const PacketClass = findSPacketMessageClass();
            const ClientSocket = findClientSocketClass();

            if (!PacketClass || !ClientSocket) {

                chatMessage(
                    "[F3] Gamemode packet sender unavailable",
                    "red"
                );

                return false;
            }

            const packet =
                new PacketClass({
                    text: `/mode ${mode}`
                });

            ClientSocket.sendPacket(packet);

            return true;

        } catch (error) {
            console.error(
                "[MB F3] Gamemode packet failed:",
                error
            );

            chatMessage(
                `[F3] Failed to change gamemode: ${mode}`,
                "red"
            );

            return false;
        }
    }

    function refreshPageSpriteBridge() {
        try {
            const bridgeName = "__MB_F3_SPRITE_DATA__";

            const existing =
                unsafeWindow?.[bridgeName];

            if (existing && typeof existing === "object") {
                return existing;
            }

            const script =
                document.createElement("script");

            script.textContent = `(() => {
                try {
                    const map = globalThis.spriteMap;
                    if (!(map instanceof Map)) return;

                    const out = Object.create(null);
                    for (const [key, value] of map.entries()) {
                        if (!value || typeof value !== "object") continue;
                        out[key] = {
                            x: Number(value.x),
                            y: Number(value.y),
                            size: Number(value.size)
                        };
                    }

                    globalThis.__MB_F3_SPRITE_DATA__ = out;
                } catch (e) {
                    globalThis.__MB_F3_SPRITE_DATA__ = null;
                }
            })();`;

            (document.documentElement || document.head || document.body)
                ?.appendChild(script);
            script.remove();

            return unsafeWindow?.[bridgeName] ?? null;
        } catch (error) {

            return null;
        }
    }

    const GRASS_BLOCK_ICON_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAQAElEQVR4Aezcy48dx3XH8aZIDh8iKUuKHpYNxw/FMBADSQwb8SaLIEDipZfZZJt/ILv8Hdnb22y1dIAgQRBAQDZOYBtBED8gO7YsgZRFUiQ1pMTczxV/o8PD6ju3h28ODX15Tp06Vd23fqeq+86QfmZ6+r9DvQJPC+BQyz9NTwvgaQEc8hU45B//6QnwtAAO+Qoc8o//9AR4WgCHcwW+/d2Xb/7ZX7+65q/+9vM3D9sq5PMeuhPgG9/5vZvIAsSKIe3DYg9NAdjxIOzOyU8+9vVrH0+nzx0Tml76wsm1lYN14xD88clKPKEflJDf/bsv3sSrXzk9HV8J/+xnjq3tqbOfCP/+O7vTlYs3pnffurZehd1VUXCMxZ//zWtP9OPhiSwAz3QQ8uqlGxPe/umVyY4P+irPvbQzIaeDgoEcc4H/pPFEFQCRQKTdqx9PdjkLfkWO9nMv76wfAzunnpluXP94fTo4Kc7/37VJ0Sgep4Q5nAYw9knhiSgAR7UXOMe445xghCMSYYNYeP/d3bXgyTf2g9/dmCoeBymSzMEqMt8gzP+489gWAAFAfCJ4toM/gtB2NkEh59jxZyZMq/85+mEO8LHqmhQUup/r5x70P248dgVgsdGf5dre6OFY9/xmiU08/cgJQFx+PfaJJwd8yGEVT4rIvK4DPpwKkPso0+/tsSkAuw2E8CEsOviITySC5/ntWZ4x8hQExIwh4oufO7l+QdQvBv3wGGD1yWNzDdfhg29e3zjcp7zHgUe+ALx0wWISC3yLjohDAOir5JlOSALVPvnoMW3XAd+JAL4Y+AqFD22nBfhOKfAfZR7JAnCUBi9dFpUAxCKi491uFEMWOMXAyvPm7qudH/LAXMh8xhFRmzUOCgsZby5xp4k4tNlQ2+bVhtMgiD9qPFIFYMfY7RY+C8UngDarCAjBaltk6E8x5MWOsJCrHwRLPqud/uxkeXzFwjeHuSEOPvQHbYz6xVLUyX8U7CNRAHWHeCkDYcCHxfLVDdV3xFtcOxj6CAc+kWEubbngO0XAVwQgIPjQZzz4ChKKz/XMBX0Vjxy4P3HXB79+Xu2HyUMtALsddqyFyoJZUDFYHIKw3tyhzebrGqGIwupjYYy2+VixoM+LojYx4fosiCun7v60xRRlBI1NkZjT/clnXZvP6mPhxIO+h8UDL4BUv+Mwu9Rif+EPz6x/IeNZbTEsMPhZWMJgLqZPbpBnbrbG0tbnHgiak0Vf0M83L/gjUmCsMd5RFFPP1YfEM6cisBGQvgdlH1gB+JBQ+bAT4IPaieDbybD7LWjQpyDAD9pEDOJOE/CDeVw3bdb1wQ8KAX4yCHHXAD9kLrsf4iz4TicoPEL7PD6XPjFU3/yKw9dI6LuXzM113wvATocP5yYsRrAIPjibfkISQNxiRgT9VUQCaBNaDiHlu4aFd/TyxV1PX66jTRA2+LZgXDDeqWQ3e09wLfcQjDOHa6SP1faSymq7TycM8pn0Jc76DKxN4H5ZmwVy7yf3pQDcOBz3Fr5+AAsBMR8afHk+PLTFwdeH9BES+iIYnyDIuIilTwx8168oOugjBviEDK4f9BET/MTt8Fw/16r3IBfp8xkgxoKvuKBtDW0g6LvX3NMCcLNw4/VGs0Di8OH0x9opsFh2XHaeHDsxC6YNbfl81qJnLjHPXzgZXJuIrgtttiIGYxWUa/Jdp5KYQqxxvqJxckFeru8e5IvJAz84XXxeVl8KM8WVPPdnbZHYvbD3pAA8s7zAEKIKom1hgg/It0g+qA9JCB/O7oHFIhhLVMjxYVkFAnHj5GUuuxheJIkI18w9uR/tOeTp69dyPcWpn3UfLOTCteBR4t7YWkzGdIzzWd0/q1/hsPrgnq0L697gdIX+u+WuCsBNwE34EKh+xCAI9FkU8C0o+IpBPrRZ8IMP7/losZB4t4pCzEKCb37wCQQCQg5qH9+14FoptsytPxgLbWtgTmiz4Lt/EBNiwTpAWx+0+xq4b8jzWAD/oCwuAL93D6oVb/348sS6MdXKuiGLFSxgFski1H5tJDe+ueRZDDE++BYHFtf15Mjn27FwrCbOGmc8kerCmsfJtD6ub/09AXnu13zGgg++a7lfeeYFHykavs8NvvlY14cxME9wiuir98cXy1htn1vbfTh9g9gSFhWAizja4EaDHc13k3ZZbjA3mQ9uoS2eRdQnHsTi+wAKyqNCnjnTpy3XB5dncfXn2nYrAcCvfeYwpo7XNofP4JTyOYjiXlnzug/wkTmNNWdwz+aGz2kOFnzzGeMzZAwrZiyMFXNPikIfMkZ/Prv+3I81x9ITYVEBXLpybDp//sgaN+VmwHeD4HfsLohbPPAtStC2UOATAnwLB7naPjT48sHfhOtjU44+iw++zwP+Jpw0kKNQfD5os+CbF3yfJWj7rODXuHbFXBAzF/hHzp2d8OGR05p77OcsKoA62aUPjk7vvH1z/RcuiaMaVSYxWG0Y44NBWy74UOnwoYIPFezi+PJQ28akGMxLCMc/+GL1HvjJd59wz/LcDyvHdYLTAbmu/uq7RyeOzwhzEFEeq52542vDNTIX6/OIeRw5EVhkLvO539z3zVPPTtB/EBYXwEfXP77tOhcuTNONoyfXf5nSzevMAvtA8EGgjzDIzrIgPhT4sFNZGOMDgw+50C+eU8i1iGFh4T5yHX0wnnWvjkzIE5fr3lI45oc+8JFr86FtrHnhfghESOP0+fwsxELGszAXq5AUHfg+jzHmdO8nXnluunn6jNAel8/v7vnbOosLwMSK4PqHH03QxtXrO9P7F49y9/BBNHwA8AkEvsWCDwU+9I0gtgWqfY5ciOkDUSE2QoHBzurXdW8wzr2An8/Chzj45gBfnoKCtjiqb5xCC/rEwK+Yr7bt9mc///xe6NjO0QkHEd8kiwrg6sXr09Hjtw85fuJ20b0jeDxc2T2+PhVcxAcL2oS0Q1htogUfOMViJyWHyFVU4/V7IQVfzGKzFX3mAV++a8D1gl0W333xWbj/9diXdzTXf5U8/WzuPzucuE4S6M+13ANcS5F4dPDlpCidFtBmP/P6i9PJVz4zfXD9xPra+eOD330Yd8+OYnudA+d2NQcJo1AvguRcu3w97to6Ea6uTgYfGBbJB/XBCeook2gBQDSLbLHF5cmRqy0n6BNjwZfLakMb1VdEYrmGfKJBjEXiuWf3LeYeU2TuVQzuSxzahHWSwLxirGsHMdcSZ30LceQrUJz7/Reml7/+krQ97Pa9xi3n5NnbN+Gt8FZmcQF0kU+dOz45GXI1/b1AfHvwwijHBwXf4kIbxIE+lQ9+0LazQuLdWlD0eG8nh3jQT2DwiQl5qMK5T8hTCFDk2nLB9/lQfW2IBdeH9vVjp+54vhO5in/t0kdSJ/G1s/rjwys3pmuXdlfe9v8tLgBTE/nkmePcPRTB7tUbe+2dU0cn7F795Ean1f9+9fOPJlhUlc5abBYWgF2lTvrtCAvFwjFqZ+m3q3dOPTMpHPDl6rNb4QglSsRJf2z6jEkO34mj2IzXdozDOPPCverLtfkwp35j4T0juSzE4LNryzf2oxOnpms3bz/mCQ39obfFic8uZVEBeOk7+dan/1ayF4GL766KwEsiP+yWIhDzaIDHg7YFQPxYi2OhIFYhmLaCqYjpAz+7VsGYL7n6xMCveQpNwUGfn3SCH8xPQO1Yfue5l3bW/0QtJ4J+84Of57tnvDa2FbPvdu0X3zpuimnbP57ZNrHmKYKL717dCykM7AVmHI8G1G4vjV4Y7big3wKD7zQgXBbRKQB9CgfVJyoscvrsVMizm+FRIga7W59rgu+arOunGOSKVZwYYefWqZT8FJb8fD722PNnJ0e9eDhx+tiEtNkbux9N4GP0kucbAPH1L2VRAeyudne9gCLYbbu79vOdBuAHjxCkzX740fEJFo4YFrKKKBYxFQIIxBqfPgIREOLQZ/fbqY5ovpczRcQ3Dytvfc2ViMa5Jgs54LuG++Ob0y5XbKw2zCdmTteEfi92MHYTnu1IjmN/TvzkHMQuKoAlF/BOgDqG6NgU845w/vwz63+zT1xCwhg7B3wLC37PEwvykTkIjPR3S1wxYoOvEMAnLgjc56m73Txwb+J2+4nVD2/MUTn/yyu1eYfvcYDaoRCQmH5HPxLb1i4qgHPvDr5u/OTOt876OOCj3pB3B9RY970feE/wiMhuczo4juVaWPBhkZMXS3S7zhj9MEbcjmS1jWcJxgfBFRiIDT7RzS8XfDFj9Bsnpu17ux/cQBuEAz9oI+2R1f/sj29OSD/BiZ82+8rzt/90UGwTiwrARKdf/coE/iZ8PUTN8e6AxJwQu+2x0t8R5OZUsPMIJ8YGbQvP2rXEiiiezd7GUfOJJIdo+ljj4KUTTg4iKxTEdx+QC9fVr4hcf/RLmfoVTj7OvLhz29c2YqK/B8itKALU2EH9RQXwxVc//RHkV5//5oRaDE4I7HczHgNIniIgPBJja462nyc4EfjEg12tPYe/bgWnB9FrHsEgRlzwPbvlQ9s1wHdN8InOhqPPnZvqj2kTr+I/+5kTq6+4Jybipz+xtFkvduBvQiEgOS89/2zcrewzW2WVpJenCxNKaCIgEuPb3UisPwbEu+BiRK/jtMUvvvvJ/4cP36PBL6EIkF1tR9q1drOdq2+d+87u+v/pw04F8VIITg07n+D6YAz45oRryBPTl7nje6Pvv5hxZOsP2l3Q3pbrbb4Whzb0Bcc80r4bu6gA3r/8qQgXL16csN/FFQNqnscAaqx/U1AE/T2hFoGxfroIpwJR7VjPfIISWo6dm12uTTyiVsuXAz74xhrjZMhXRm1ze6HzYgcxEJmt2P097u1+TvyM9ShA2tvapXmLCmBucsc+0l/9xLrgiddcRXBHsZw5PvV3CWP7L6F+86ubk28P+iof3Pq/famnQvp3Vl/3oO00gDaB7Xjo0wb/5OqXMn54ww8jke1a8eRo84nPYk7gXhxe9jLeOMc86inAh/4lHLgATlz+9YR6sefPnJpQY9v4imD0ONhZ/Tg54xUG8kgQ91gBPzgN8oMlL4DiTgbs3BLczvZzAC9s0GaD3R/S540e5pvDs5x4SI4f4lTxEu/if9B+s2cMiJ8x98MuKoDnzpycPAaQm1EE9eUw8S6MeC+OKqZ+RbBz6pP//z5t7KyKwOOAH/q4xHfLD6X8UAkeB3l2y+Pb2RU7P20+0vZiB2NhB/uhDLRBPOLzK8Sv7e5HYOPTt63g7773weQUyLhY8fjb2EUFsGlCRaBAkDxFYHenzfYiEFsz+HnCOr7wDwWDDPO3lZwIHhF59nvG6/dsBz873ilw4f2jk1/M1KPecQ65m5CD5PBPnt1Z/dbuk79HIO6EID4/aHfxv3TsW+leW0c8qsjaWCcc4I9nloypOz/jCD6K75bv94pgJHzNWc+3KoI7YqsOhbQy6/+8GKLGCI51wq0/nCa41VwbL4xwrBOc2EGCH9iAXj9/VAAAEABJREFUH+xOpM3a2eDD1zA50AYxic8Pjn3ipx1L/PjEfP+3V6Yq/rkv//FkvuSwdn8tBDGIs9uyqADqpO9dvjohsf2KIHnsqBjEA3GR9pz1Ioj0e4mMX21/ZOSnjI56+O5ej3lj+w9jCA59SyEwNo0jMPFrzosvvjgRv8b4S0U2Zo5FBfClz74w2fF1MsL3mMeBXV/zuq8I9svx7MfoVOjz7ddWBE4EJNdjwU/t0rZDUcUnHJLDygE/OAWQ9tr+++prM9aN6bYf494KrQ3x186tP+x+4t9qThd/9sOpF4fd/9v3LidlbRXGay+cXfvb/rGoADJpF1x8FCMwofVDDhSSNvSDH3xlRNqsucCHovD1ENpwauyWF0Gx3hZTVGyl724/jBkd1zWmCFDn8RhAjY18omPUl9j58+fX4qcdS/z4scSPv8QuKoALl66svwXUC3gMOAVqrLe7wHIVwSheRZbXsZNR4wRFYkSXg8TY/p4gNoL4o/i9iHm+Y7+5iL8ph+D9VLD7f33h0qZhd/QtKoCM7gKL9xhxoS+8cPb0hLTv1lbRM1cXXXy3vJCmCGqeXd1f2Izru1u7F0c/9j0uYHyw05H2tjZHfxea+H0O4vfYNu0DFUCduIuszzHPzuEkQc0zD+oYRylqjJhITBE4+pEYcfsjpI6pecRPmx19nxcnPgsCo4uvbz8UAmoegZEY4ZE225/3Yr0Q7P7R40HuHAcugCqWxwD6KdAvSnT0eG+bG4mPHgujWBdZESiGzBNbiyUxhVbFrz/oSQ7Re8Hoq+JpE7jHxEcx8U0QHskhut2OxFjis0tZVABd4CpSLiwHacd+eOa1uOv3iJ6jgLCXtHKIjJW795829gIrpwu/Cg3/c1qkwxikHXv+l5dWv6P/9G8yixOU+Pw5iAu5ydFG2qw2+HOM+sWIX8eMdnvPqfkjf1EB1AmqWAoBtX/kEx3pq35i5qmPhsS7lWfXJk5MhcEmxjoF2KAIeo4+xznx+ZUqaPWTQ5j4sXOxkTg1Vz8yz5y12zHXvyS+qAC6MLUI5i564rWvTaj95kGNERSJ6ddGYiOrCF49+tXburrACgP16NeGZztum8B3d5RgF1+7iif1j77y6m3f1x3d6Hly98MY1DzHPhIbFcvoVEj+yC4qABP4+gb+JgiI5Jw7d27yGEBiI6uofvH2e6OuO2JV+OrXxF5AioDwNWfOHx37ioX4dQwhiJ+YdvxYhfCjn/02zbWdE7jOJQfrAbf+IDI075ZFBVC/wllYECw3QXCkzfpLI+AHRz/SHtm5InDNmk94xVVjS3wio47x41ck1gVIvFvHchffWOL3XPHECI60WW3ww3/+9O0JaSsC10NiS+2iAjC5t3jwgxMBta1YkBjrV8fsJvwYuYssv8aqrw+KoP79RDHUgvQ+APEOwb/5yncmpM9Or0KJ92IRcywTnw/CsHXs17/8ym2PB/1z1LnmcnrcNdHj+7UXFcDPf3Nhbz4Li73AyiE4Vu7ef187e21CAnNF0OcaiTyKmbeeMI53iAfjkDarDSJDbAlV3IwjANKOJX78kSU4ap82amzke6xg1LdNbFEBjCa0iE4EpL/6iZ28+IupnhLi9fGhrQgUUM9zDf2bUARX3v7pXoox2O9Rszdg5fjxK1bu+j/COV6xDqz+UCxdfEKNhF+l7/3nlOhH+ujRYK69Qbecev1bobWp4+Vg3bHgjwMXgIXFftdSDEgecQmddmyfS1765izBUfuJjhpzPYxiRMYXpt/sdZ96738n7AVWjhys3Nn/RgKIEb8OEqvi6VNAVXxtyNUPY8APihFpL7WLC4BQqBfqbX1VdG05NUYQQtVTQI7cbTA+eYoA5kvsIJbo2DR2tNhdqIyv4okRuMbMRVDj9Yf92vKMY4MiQ9rb2sUFMDcx8QiM5PDF02bF2EotAnE5qCKLdwiOHq9tc7gHJN7H9AUnEmqcj8zBXn3+9Qn8OfqY5BE/Put6bKeONwZVfI8V9HHbtu+6ACxwF9DF64Lz5YnvB+FrjnF1fo8GeFeoedv4hEfNrQtc40t8RWAe1HG9PdqhBO3i93adM75x8WP7CZP4JnvgAiAMMjmR+nd3wqe/2honCGo/cVFjI18hIH3uISTmWmJpx4rHt+BdLG3xmlPb4v7WDvjB7kTaLGHAR+au842Ko89jrN1exX/zwpkJdX5527KoAEYLSagqoCKoi5sb6THtWkBzeeJ1ficExIN+pD2yo3t3D1UECw4CjeZI7PTrfzoh7ZE1T48Tqc/t+l18X+vqeDmER+bk10IQf2v67NTnF9/EogLYNNF+Amwa2/sIjBonIGpMDmqs34ci6zH54ixGi0aAHu9tY1FfHIkC8WAc0h7ZFEfNMw/xa7484teYU4j4Nbatv6gARgtJgLqYLtyFmovZgfpgDPhBP9JmtcEPHgNI2326J9RY/Fj9dcETJ358/SExPytA2iyhwJ/DPHJQc4ha24RHjclBYnynEPETU4h97vTN2UUFUCfpIljM2j/yjUHtIzpqTA4SMzdRkZjCix9b+xPziDI+bVZbnA87qi8cAWohyEPPe/b8jybj9VWMr+1tfNdDcs3r8YDE+MRPO5b48ZfYRQVgl1m8XKCKlBg7EqLGCB7kz+FaqP3aqDHFgBqrAov3MWJyLDK/sp94337h8gTi13HdJyZq3CmAxPghMXZ0X8TXF/opJG4udlsWFUAm7YupEFBFTm6124gup46J368p7prsHARWGD1PvI8ZLVwvBKJ0EYzrO7KfEooA9ZrGocZcDzXW/frbwPSNCiF9+9lFBWAx+4R9cXsREA5Ojz62to1DjZkbiZmHeEhMP9KOrb+4Eus5PguIBzkYCUBQ4usPxlQB+ZCbnJHVj1FfYorF/EiMJT4bHPt3I755FhWAARYS/E0QCzXHr3qRGMG1UWPx97N1fvdU28YqAnF+hfC1HX9O/PRHkFjxkZgKgYj6Q59bP9I/Z10Ltd/8SMzfIDYXEtvWLiqA0WKOLlSFsFtR8wiPGhv55kHt6+L1/pobXw7SZn0W8CujRXTsj0SYEz/zET0kRjikzZoH/CAHac9Z4te+0f3X/u4vKoA+OG3PbaQ9ZxUC0k+U2hYfzUMo6Ici0PZDJ+0gFv8gti+eY5/4dS6FUIWpfvL6POKjmOKowrse5AfzI+05ay7M9c/FD1wAhApzk4sTC/xAeKStCLwjIDG2C6oNfUERuI+0Y2vMGKSPdX1YXIgFYiHtObvtuDoXH1UsRYZ6HTmoMcWCxPh/+c3XJyS236+skxd74ALIBKzjHHxY7KCNXgRihO9x83Txats4c/dYb8vrMYJDX8fOIwrSZ7fHj+2ii4tVsczRhRCrOcYRsAvvmnL1wxi4hvYc7h9z/XPxAxcAoTA38aY44ZEcRYC0WeKBP4frh7kccfOAHxQRiIDEWQKAvwnCoOb0cUTpMe1+TXMQn4Uc8IMiQNqsMeCj94tt4sAFUCd1dKPG+k4jeBfZW3odo7+PIxyRax6/x7TrWG0YLx8eF+CPIArSZzEtLhIb2V4Ecuxs4vOReauocvrcrplc41DHaOuH8dowD/hLOHABWGxsution8ijMXZjjxMwMXOFxEZWIWLUl1i9lkXEfotHGGQOljDgg08YaMO8tS3m7w+4Jj/I6/PrMyd7v1hUAAToN/KNP/jc1EW16+oiG9N3uxhqHh/iQRH06/Y2weGUyThtpM2aC/wRBEDt86tZ1Fj3Pe+7UARFzf3St/7itr9BlP7Y5PZ7SLzaXkDp68WW+JxdVAB1EkIhsV4E4rVfO/RceVXUV7/6JxPqvyIiLjIHq9DAD+ZG2iPB67Xk9Z+wWUTUo50P+cERj7RZwoAPYgbt0EVPfJN1T6jzb8rfpm9RARCqT2qxe9yid2GMq3nG9R1KmCq6MdpVeD7qWHNBftBG2qwx4IcufuKbLBGQHIJoIzGW8GzY9se2fZ5eeOZTQP3e+/Xk7ceiAtg0GXG76NridVxvp6/G/R1/pI8lJvhLILiCrGMUUG3z++IRtR7rfMjdBFFQczzzkZif4bseEqt+YoRH2rHEjx87Gp++TXZxAdildUJv1YROLH5d9Cpu8tguqLzRvxzqecZWjEONERmJuZ//vnRyQmLd2nkgfu+rbf3YFCOIuVDziF/bfLls0K7CjwpPTp/b+P3eV+RUFheAwb0IxAhvkfmht41D+lk7FPwlKArzI+PE4seK9X+eLtbvI/mxdtlogWtMDjJmzhIdtd88SMy7REiM7eITHvruBYsKwKL1neYmqgjV17eJ0Vw132mAGiMeakzxocZ860BiisA/IE2b9XnYThWVAKg5+lFjI59QSF8vAnH9hOeHuvsTY+WyobeN6/ea3Dm7qAAyyUg4ws8taB3XxxITyWGJDj76mMT69UZ5cuv7hCJ4Z3ph/X9Tow8Wju30Ba47NrkeBbUYiIn0z1lzo/abB4n5eumaSGxkHftzn2GUX2OLC6AvOuHrhPpHR3rdod4bIDdj+Uh7W2uMe8CmMbUIkqdg+sJ1UZI7EoH46Scc0p6zrof08700IjG7mPhpb7LET79xo/tM/8guLgCTWHQ2EBz1pUsbyWEVAfhz9LnljWLiBGSDuXtMu54mcntbDFX86uuDGPihCpeYQqinAFGQfpbw4AdiIm3W9cCHeYJ2IH78JXZRAbzx5v8c6ZN3cRRBP9KNqTuUD/FNEBQ1h6BIrPo11u+L6PUU0A8Lh4xl64JrYxSbE18+5oTq15NbMa62+WLgh94W/4c3/uMOjcTnWFQAJlEE+NcfvbV3IYJDf9BG2iNLvJB+7fixYkg7loDx2V5UvV9OLQLtMFrMvkPljvJ6cWg7BeQHsfisIgA/aCNt1vXAn+NfVlr847/95AjmcubiiwugTqQIFEONdZ8IqHG7GjXmnQA1RlAkpgj6Y6XPXXPjx/on5PHNBUc1Er9b24U2X425FsQ3YQySU/3E7Hbip30Qe1cFkAsqAqTNWlzwQShiQjv4ehY/tousWFD75dT501ftqF8R1LmSP1rgvhvljvL6Du1t49CFlzd62Rtdw/hAeKR9N/aeFEBu4Pv/9MMjSHvOKgKkXxFoIzECI22WcPW7vRiRxflzKD74zWXPcVQjccd+SIztsZFIXuCIKj+IxWddCzWvzy1PP/iB6Ej7Xth7WgC5IaeBxwMSI1T8WMLHj+2ia9fCkKcI+vuFIoD+CuFrWxH0+dJPiPhs37Ficrr42lVobdTYaC45MG8wPz8QHAd5vmeOTfa+FEC9oGJAjY18v/Xr8S5y7yc4ely7Cu+bCcSDcSAAEp+zHgeY6xfX3+cS6+L7+UHNk4MqPtFh3vvJfS+A3LzTAGmz/Y1cEfTdrQiIWf/xiLH9hVGs72zjqvDmglNFfocISNxRHT+29idGuB73L3drzFdG8xE/4/oRL+6l7n7tdvN3HlgB5MKKICTG+p7OBkJV8cR7ERAcPS53P4zBKF7CWnoAAAJuSURBVM9fs8aor8YIj8Sqn5hfAxM/bVa7ik9wEF//g+SBF0D9cG+++eaRH/zgB3s/T+hFIFcRjN4fCK8/ENOOTztWIcXfzxIFyXNMExWJzdlRDvF7PvETc8QTPu2HYR9qAeQDKwKnQtqxHgfxFQE8txMjONKes+ZB+hWFuZBYtY5q1NjId8QjfXxHPxIb/QaQ6MRPzsO0j0QBZAEUAdJmCddFrkUgJ1RB+UjfNtaOR80lKhLrL3Ti+sGvdPGJTvya87D9R6oAshi+NaAXQ/pjCYy0R1a/AkLtr+167Mvx9Q31WCc89AfjkDbr7/2BD4IH7UeNR7IA6iIpAsWQmGc/6ilAZCRnW6sIuoB9rH7UuDZqrPvf+973DvSz+T7P/W4/8gWQBVAISHtkCRpqfy+O3u7HfsbWY907QUi/cUibfeONN46A/zjw2BRAFlMRIG12JHqPddGNQxdQrOJ7O2ps5D/Kx/zofhN77AogN/5fv3j3iEJAYmwXWiGId/oPkvqRbvf3Z745asFEdFbf48hjWwB1sb0jILFeBIl30Xs7ecSPP7Le5jHqe9xiT0QBZNEVQT8R9NVTgOheIL1I6oPdX3d2Yp75/ED0x3m353NU+0QVQD6YIlAMabO1CLShCIjPr/TY33//n48Qv+Y8Kf4TWQARRxGExFjCs5UuOsFB/Jr3pPlPdAFUsRSCF8fEnAhIO9YRT/i0H5R9WNc5NAWQBVYEHhFpxxKd+GkfFnvoCiDCOhFAeCR+2OyhLYDDJvTc531aAHMrc0jiTwvgkAg99zGfFsDcyhyS+NMCOCRCz33MpwUwtzIPKP6wL/P/AAAA//+a+9KwAAAABklEQVQDACDYsHgv0fduAAAAAElFTkSuQmCC';

    function getGamemodeIconSource(itemName) {
        try {
            if (itemName === "grass_block") {
                return { url: GRASS_BLOCK_ICON_DATA_URL };
            }

            const resourceManager =
                gameModule?.Jo;

            if (!resourceManager?.atlas) {

                return null;
            }

            const itemRegistry =
                gameModule?.hc;

            let item = null;
            try {
                item = itemRegistry?.getItemByName?.(itemName) ?? null;
            } catch {}

            if (!item) {

            }

            let textureName = itemName;

            if (item) {
                try {
                    const ItemStack = gameModule?.V;

                    if (typeof ItemStack === "function") {
                        const stack = new ItemStack(item, 1);

                        if (typeof stack.getTextureName === "function") {
                            textureName = stack.getTextureName();
                        }
                    } else if (typeof item.getTextureName === "function") {
                        textureName = item.getTextureName();
                    }
                } catch (error) {

                }
            }

            if (textureName === "book") {
                textureName = "written_book";
            } else if (textureName === "glass_bottle") {
                textureName = "potion";
            }

            let spriteMap = null;
            try {
                if (unsafeWindow?.spriteMap instanceof Map) {
                    spriteMap = unsafeWindow.spriteMap;
                }
            } catch {}

            let sprite =
                spriteMap?.get(textureName) ??
                spriteMap?.get(itemName) ??
                null;

            if (!sprite) {
                const bridged = refreshPageSpriteBridge();

                sprite =
                    bridged?.[textureName] ??
                    bridged?.[itemName] ??
                    null;
            }

            if (!sprite || Number(sprite.size) <= 0) {

                return null;
            }

            const atlas = resourceManager.atlas;

            const atlasWidth =
                Number(resourceManager.atlasWidth) || 1024;

            const atlasHeight =
                Number(resourceManager.atlasHeight) || 1024;

            const atlasScale =
                Number(resourceManager.atlasScale) ||
                atlasWidth / 1024 ||
                1;

            const sx =
                Math.round(Number(sprite.x) * 16 * atlasScale);

            const sy =
                Math.round(Number(sprite.y) * 16 * atlasScale);

            const size =
                Math.max(1, Math.round(Number(sprite.size) * atlasScale));

            const canvas = document.createElement("canvas");
            canvas.width = size;
            canvas.height = size;

            const ctx = canvas.getContext("2d");
            if (!ctx) return null;

            ctx.imageSmoothingEnabled = false;

            ctx.drawImage(
                atlas,
                sx,
                sy,
                size,
                size,
                0,
                0,
                size,
                size
            );

            const url = canvas.toDataURL("image/png");

            return { url };

        } catch (error) {

            return null;
        }
    }

    function createGamemodeIcon(itemName) {
        const container = document.createElement("div");

        Object.assign(container.style, {
            width: "38px",
            height: "38px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "visible",
            backgroundColor: "rgba(0, 0, 0, 0.35)",
            border: "1px solid rgba(255, 255, 255, 0.18)",
            boxSizing: "border-box",
            imageRendering: "pixelated",
            flexShrink: "0"
        });

        const source =
            getGamemodeIconSource(itemName);

        if (source?.url) {
            const image = document.createElement("img");

            image.src = source.url;
            image.alt = itemName;

            Object.assign(image.style, {
                width: "32px",
                height: "32px",
                maxWidth: "32px",
                maxHeight: "32px",
                objectFit: "contain",
                display: "block",
                imageRendering: "pixelated",
                pointerEvents: "none",
                userSelect: "none"
            });

            container.appendChild(image);
        } else {
            container.textContent = "?";
            Object.assign(container.style, {
                color: "white",
                fontSize: "20px"
            });
        }

        return container;
    }

    function closeGamemodeMenu() {
        if (!gamemodeMenuOpen) {
            lastF4Press = false;
            return;
        }
        const originalMode = gamemodeOriginalMode;
        const selectedMode = gamemodePendingMode ??
            GAMEMODE_OPTIONS[gamemodeMenuIndex]?.id ??
            originalMode;

        gamemodeMenuOpen = false;
        lastF4Press = false;
        gamemodeOriginalMode = null;
        gamemodePendingMode = null;

        if (gamemodeMenuRoot) {
            gamemodeMenuRoot.remove();
            gamemodeMenuRoot = null;
        }

        if (
            selectedMode &&
            originalMode &&
            selectedMode !== originalMode
        ) {
            if (sendGamemodePacket(selectedMode)) {
                const selected = GAMEMODE_OPTIONS.find(
                    option => option.id === selectedMode
                );

                chatMessage(
                    `[F3] Gamemode: ${selected?.name ?? selectedMode}`,
                    "white"
                );
            }
        }
    }

    function updateGamemodeMenu() {
        if (!gamemodeMenuRoot) {
            return;
        }

        const selected =
            GAMEMODE_OPTIONS[gamemodeMenuIndex];

        const title =
            gamemodeMenuRoot.querySelector("[data-f3-mode-title]");

        const hint =
            gamemodeMenuRoot.querySelector("[data-f3-mode-hint]");

        if (title) {
            title.textContent = selected.name;
        }

        if (hint) {
            hint.textContent =
                "[F4]  → Next";
        }

        gamemodeMenuRoot
            .querySelectorAll("[data-f3-mode-icon]")
            .forEach((element, index) => {
                const selectedIcon =
                    index === gamemodeMenuIndex;

                element.style.border =
                    selectedIcon
                        ? "2px solid white"
                        : "1px solid rgba(255, 255, 255, 0.18)";

                element.style.backgroundColor =
                    selectedIcon
                        ? "rgba(255, 255, 255, 0.18)"
                        : "rgba(0, 0, 0, 0.35)";

                element.style.transform =
                    selectedIcon
                        ? "scale(1.08)"
                        : "scale(1)";
            });
    }

    function openGamemodeMenu() {
        if (gamemodeMenuOpen) {
            return true;
        }

        const currentMode =
            getCurrentGamemode();

        const currentIndex =
            GAMEMODE_OPTIONS.findIndex(
                option => option.id === currentMode
            );

        gamemodeMenuIndex =
            currentIndex >= 0
                ? currentIndex
                : 0;

        gamemodeOriginalMode =
            GAMEMODE_OPTIONS[gamemodeMenuIndex]?.id ?? "survival";

        gamemodePendingMode =
            gamemodeOriginalMode;

        gamemodeMenuOpen = true;

        const root =
            document.createElement("div");

        gamemodeMenuRoot = root;

        root.id = "mb-f3-gamemode-switcher";

        Object.assign(root.style, {
            position: "fixed",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: "2147483647",
            pointerEvents: "none",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "4px",
            fontFamily: "Minecraft, Arial, sans-serif",
            userSelect: "none"
        });

        const panel =
            document.createElement("div");

        Object.assign(panel.style, {
            minWidth: "210px",
            padding: "5px 7px 6px",
            boxSizing: "border-box",
            background:
                "linear-gradient(rgba(25,25,25,.92), rgba(5,5,5,.92))",
            border: "2px solid rgba(120,120,120,.9)",
            boxShadow:
                "0 3px 0 rgba(0,0,0,.65), 0 0 0 1px rgba(0,0,0,.9)",
            imageRendering: "pixelated"
        });

        const title =
            document.createElement("div");

        title.dataset.f3ModeTitle = "true";

        Object.assign(title.style, {
            minHeight: "22px",
            padding: "2px 7px",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            background:
                "linear-gradient(rgba(55,55,55,.95), rgba(25,25,25,.95))",
            border: "1px solid rgba(0,0,0,.95)",
            fontSize: "14px",
            fontWeight: "bold",
            textShadow: "1px 1px 0 #000",
            whiteSpace: "nowrap"
        });

        panel.appendChild(title);

        const row =
            document.createElement("div");

        Object.assign(row.style, {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "3px",
            marginTop: "5px",
            padding: "2px"
        });

        for (const [index, option] of
            GAMEMODE_OPTIONS.entries()) {

            const cell =
                document.createElement("div");

            cell.dataset.f3ModeIcon = "true";

            Object.assign(cell.style, {
                width: "43px",
                height: "43px",
                padding: "2px",
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "transform 0.05s ease"
            });

            cell.appendChild(
                createGamemodeIcon(option.icon)
            );

            row.appendChild(cell);
        }

        panel.appendChild(row);

        const hint =
            document.createElement("div");

        hint.dataset.f3ModeHint = "true";

        Object.assign(hint.style, {
            marginTop: "1px",
            padding: "1px 5px",
            color: "#e6e6e6",
            fontSize: "11px",
            textShadow: "1px 1px 0 #000",
            whiteSpace: "nowrap"
        });

        panel.appendChild(hint);
        root.appendChild(panel);
        document.body.appendChild(root);

        updateGamemodeMenu();

        return true;
    }

    function cycleGamemode() {
        if (!gamemodeMenuOpen) {
            openGamemodeMenu();
            return;
        }

        gamemodeMenuIndex =
            (gamemodeMenuIndex + 1) %
            GAMEMODE_OPTIONS.length;

        const mode =
            GAMEMODE_OPTIONS[gamemodeMenuIndex];

        gamemodePendingMode = mode.id;
        updateGamemodeMenu();

    }

    unsafeWindow.Miniblox.openGamemodeMenu =
        openGamemodeMenu;

    unsafeWindow.Miniblox.closeGamemodeMenu =
        closeGamemodeMenu;

    unsafeWindow.Miniblox.cycleGamemode =
        cycleGamemode;

    function findTargetController() {
        try {
            const direct = gameModule?._o;
            if (direct && typeof direct === "object" && "objectMouseOver" in direct) {
                f3TargetController = direct;
                return direct;
            }
        } catch {}

        if (f3TargetController) {
            try {
                if ("objectMouseOver" in f3TargetController) {
                    return f3TargetController;
                }
            } catch {}
            f3TargetController = null;
        }

        try {
            for (const value of Object.values(gameModule ?? {})) {
                if (!value || (typeof value !== "object" && typeof value !== "function")) continue;
                try {
                    if ("objectMouseOver" in value) {
                        f3TargetController = value;
                        return value;
                    }
                } catch {}
            }
        } catch {}

        const roots = [
            game,
            game?.player,
            game?.input,
            game?.controls,
            game?.gameScene
        ];

        const visited = new Set();
        const queue = roots.map(value => ({ value, depth: 0 }));
        const maxNodes = 6000;
        let nodes = 0;

        while (queue.length && nodes++ < maxNodes) {
            const { value, depth } = queue.shift();

            if (!value || (typeof value !== "object" && typeof value !== "function")) {
                continue;
            }

            if (visited.has(value)) continue;
            visited.add(value);

            try {
                if ("objectMouseOver" in value) {
                    f3TargetController = value;
                    return value;
                }
            } catch {}

            if (depth >= 5) continue;

            let keys;
            try {
                keys = Object.keys(value);
            } catch {
                continue;
            }

            for (const key of keys) {
                if (key === "parent" || key === "children" || key === "scene") continue;

                try {
                    const child = value[key];
                    if (child && (typeof child === "object" || typeof child === "function")) {
                        queue.push({ value: child, depth: depth + 1 });
                    }
                } catch {}
            }
        }

        return null;
    }

    function refreshNativeTarget(controller) {
        if (!controller) return false;

        try {
            let proto = controller;
            const visited = new Set();

            while (proto && proto !== Object.prototype && !visited.has(proto)) {
                visited.add(proto);

                for (const name of Object.getOwnPropertyNames(proto)) {
                    if (name === "constructor") continue;

                    let fn;
                    try {
                        fn = controller[name];
                    } catch {
                        continue;
                    }

                    if (typeof fn !== "function") continue;

                    let source = "";
                    try {
                        source = Function.prototype.toString.call(fn);
                    } catch {
                        continue;
                    }

                    if (
                        source.includes("this.objectMouseOver=") &&
                        source.includes("getLook") &&
                        (source.includes("world") || source.includes("$."))
                    ) {
                        fn.call(controller);
                        return true;
                    }
                }

                proto = Object.getPrototypeOf(proto);
            }
        } catch (error) {

        }

        return false;
    }

    function copyTextToClipboard(text) {
        try {
            if (navigator.clipboard?.writeText) {
                return navigator.clipboard.writeText(String(text)).then(
                    () => true,
                    () => false
                );
            }
        } catch {}

        return new Promise(resolve => {
            try {
                const textarea = document.createElement("textarea");
                textarea.value = String(text);
                textarea.style.position = "fixed";
                textarea.style.opacity = "0";
                document.body.appendChild(textarea);
                textarea.select();
                const ok = document.execCommand("copy");
                textarea.remove();
                resolve(ok);
            } catch {
                resolve(false);
            }
        });
    }

    function safeValue(value, depth = 0, seen = new Set()) {
        if (value == null) return value;
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            return value;
        }
        if (typeof value === "bigint") return String(value);
        if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
        if (depth > 2) return `[Object]`;
        if (seen.has(value)) return "[Circular]";
        seen.add(value);

        if (Array.isArray(value)) {
            return value.slice(0, 32).map(item => safeValue(item, depth + 1, seen));
        }

        const out = {};
        try {
            for (const key of Object.keys(value).slice(0, 40)) {
                try {
                    out[key] = safeValue(value[key], depth + 1, seen);
                } catch {}
            }
        } catch {}
        return out;
    }

    async function copyTargetedData() {
        try {
            const controller = findTargetController();

            if (!controller) {
                chatMessage("[F3] Target controller unavailable", "red");

                return false;
            }

            refreshNativeTarget(controller);

            const mouseOver = controller.objectMouseOver;

            if (!mouseOver) {
                chatMessage("[F3] Nothing targeted", "red");

                return false;
            }

            let data;
            let text;

            if (mouseOver.block != null) {
                const block = mouseOver.block;
                let state = null;
                let blockName = null;
                let properties = null;

                try {
                    state = game.world?.getBlockState?.(block) ?? null;
                    blockName = state?.getBlock?.()?.name ?? state?.block?.name ?? null;
                    properties = state?.properties ?? null;
                } catch {}

                data = {
                    type: "block",
                    position: {
                        x: Number(block.x),
                        y: Number(block.y),
                        z: Number(block.z)
                    },
                    block: blockName ?? "unknown",
                    state: properties ?? {}
                };

                text =
                    `Coords: X: ${Number(block.x)}, Y: ${Number(block.y)}, Z: ${Number(block.z)}\n` +
                    `State: ${JSON.stringify(properties ?? {})}`;
            } else if (mouseOver.entity != null) {
                const entity = mouseOver.entity;
                const entityType = entity.type ?? entity.constructor?.name ?? "unknown";
                const entityName = entity.name ?? entity.username ?? null;
                const position = entity.pos ? {
                    x: Number(entity.pos.x),
                    y: Number(entity.pos.y),
                    z: Number(entity.pos.z)
                } : null;
                const health = typeof entity.getHealth === "function"
                    ? entity.getHealth()
                    : entity.health ?? null;

                const entityState = {
                    id: entity.id ?? null,
                    type: entityType,
                    name: entityName,
                    health,
                    data: safeValue(entity)
                };

                data = {
                    type: "entity",
                    id: entity.id ?? null,
                    entityType,
                    name: entityName,
                    position,
                    health,
                    data: safeValue(entity)
                };

                const coordText = position
                    ? `Coords: X: ${position.x}, Y: ${position.y}, Z: ${position.z}\n`
                    : "Coords: X: N/A, Y: N/A, Z: N/A\n";

                text =
                    `Entity: ${entityType}${entityName ? ` (${entityName})` : ""}\n` +
                    coordText +
                    `State: ${JSON.stringify(entityState)}`;
            } else {
                data = {
                    type: mouseOver.typeOfHit ?? "unknown",
                    hitVec: safeValue(mouseOver.hitVec ?? null),
                    data: safeValue(mouseOver)
                };

                text = JSON.stringify(data, null, 2);
            }
            const copied = await copyTextToClipboard(text);

            if (!copied) {
                chatMessage("[F3] Failed to copy targeted data", "red");
                return false;
            }

            chatMessage(`[F3] Copied ${data.type} data`, "white");

            return true;
        } catch (error) {
            console.error("[MB F3] Targeted data failed:", error);
            chatMessage("[F3] Failed to read targeted data", "red");
            return false;
        }
    }

    unsafeWindow.Miniblox.copyTargetedData = copyTargetedData;

    function toggleSpectatorPrevious() {
        try {
            const p = game?.player;
            const mode = getCurrentGamemode();

            if (!p) {
                chatMessage("[F3] Player unavailable", "red");
                return false;
            }

            if (mode === "spectator") {
                const restore =
                    f3PreviousGamemode && f3PreviousGamemode !== "spectator"
                        ? f3PreviousGamemode
                        : "survival";

                if (!sendGamemodePacket(restore)) return false;

                chatMessage(`[F3] Gamemode: ${restore}`, "white");
                return true;
            }

            f3PreviousGamemode = mode;

            if (!sendGamemodePacket("spectator")) return false;

            chatMessage("[F3] Gamemode: spectator", "white");
            return true;
        } catch (error) {
            console.error("[MB F3] F3+N failed:", error);
            chatMessage("[F3] Spectator toggle failed", "red");
            return false;
        }
    }

    unsafeWindow.Miniblox.toggleSpectatorPrevious = toggleSpectatorPrevious;

    setInterval(() => {
        try {
            const mode = getCurrentGamemode();
            if (mode && mode !== "spectator") {
                f3PreviousGamemode = mode;
            }
        } catch {}
    }, 500);

    function showF3Help() {
        const messages = [
            "[F3] F3+A  Reload chunks",
            "[F3] F3+B  Toggle entity hitboxes",
            "[F3] F3+C  Copy coordinates",
            "[F3] F3+D  Clear chat",
            "[F3] F3+G  Toggle yellow 3D chunk grid",
            "[F3] F3+L  Start/stop performance recording",
            "[F3] F3+V  Dump version information",
            "[F3] F3+W  Toggle wireframe rendering",
            "[F3] F3+I  Copy targeted data",
            "[F3] F3+N  Spectator/previous mode",
            "[F3] F3+Q  Show this help",
            "[F3] F3+F4 Gamemode switcher"
        ];

        for (const message of messages) {
            chatMessage(message);
        }
    }

    document.addEventListener(
        "keydown",
        event => {
            if (event.code !== "F3") {
                return;
            }

            event.preventDefault();
            event.stopImmediatePropagation();

            if (f3Down || event.repeat) {
                return;
            }

            f3Down = true;
            f3WasPressed = true;
            f3ComboUsed = false;
        },
        true
    );

    document.addEventListener(
        "keyup",
        event => {
            if (event.code === "F4") {
                lastF4Press = false;
                return;
            }

            if (event.code !== "F3") {
                return;
            }

            event.preventDefault();
            event.stopImmediatePropagation();

            const wasCombo = f3ComboUsed;

            f3Down = false;
            f3WasPressed = false;
            f3ComboUsed = false;

            closeGamemodeMenu();

            if (!wasCombo) {
                toggleNativeDebugMenu();
            }
        },
        true
    );

    async function toggleNativeDebugMenu() {
        try {

            const guiToastURL = findGuiToastURL();

            if (!guiToastURL) {

                return false;
            }

            const guiToastModule =
                await import(guiToastURL);

            const settings = guiToastModule?.p;
            const debugOption = settings?.debug;

            if (!debugOption || typeof debugOption.value !== "boolean") {

                return false;
            }

            debugOption.value = !debugOption.value;

            chatMessage(
                `[F3] Debug: ${debugOption.value ? "ON" : "OFF"}`,
                "white"
            );

            return debugOption.value;
        } catch (error) {
            console.error(
                "[MB F3] Native F3 debug toggle failed:",
                error
            );
            return false;
        }
    }

    unsafeWindow.Miniblox.toggleNativeDebugMenu =
        toggleNativeDebugMenu;

    document.addEventListener(
        "keydown",
        event => {
            if (!f3Down) {
                return;
            }

            if (event.code === "F3") {
                return;
            }

            const key =
                event.key.toLowerCase();

            f3ComboUsed = true;

            if (key === "a") {
                event.preventDefault();
                event.stopImmediatePropagation();

                reloadChunks();
                return;
            }

            if (key === "b") {
                event.preventDefault();
                event.stopImmediatePropagation();

                toggleHitboxes();
                return;
            }

            if (key === "c") {
                event.preventDefault();
                event.stopImmediatePropagation();

                if (cHolding) {
                    return;
                }

                cHolding = true;

                copyPlayerCoords();

                cHoldTimer = setTimeout(() => {
                    if (!cHolding) {
                        return;
                    }

                    chatMessage(
                        "[F3] F3+C held for 10 seconds"
                    );

                }, 10000);

                return;
            }

            if (key === "d") {
                event.preventDefault();
                event.stopImmediatePropagation();

                clearChat();
                return;
            }

            if (key === "w") {
                event.preventDefault();
                event.stopImmediatePropagation();
                toggleWireframe();
                return;
            }

            if (key === "l") {
                event.preventDefault();
                event.stopImmediatePropagation();
                togglePerformanceRecording();
                return;
            }

            if (key === "v") {
                event.preventDefault();
                event.stopImmediatePropagation();
                dumpVersionInfo();
                return;
            }

            if (key === "i") {
                event.preventDefault();
                event.stopImmediatePropagation();
                copyTargetedData();
                return;
            }

            if (key === "n") {
                event.preventDefault();
                event.stopImmediatePropagation();
                toggleSpectatorPrevious();
                return;
            }

            if (key === "g") {
                event.preventDefault();
                event.stopImmediatePropagation();

                toggleChunkBorders();
                return;
            }

            if (event.code === "F4") {
                event.preventDefault();
                event.stopImmediatePropagation();

                if (event.repeat || lastF4Press) {
                    return;
                }

                lastF4Press = true;
                cycleGamemode();
                return;
            }

            if (key === "q") {
                event.preventDefault();
                event.stopImmediatePropagation();

                showF3Help();
                return;
            }

        },
        true
    );

    document.addEventListener(
        "keyup",
        event => {
            if (event.key.toLowerCase() !== "c") {
                return;
            }

            if (!cHolding) {
                return;
            }

            cHolding = false;

            if (cHoldTimer) {
                clearTimeout(cHoldTimer);
                cHoldTimer = null;
            }

        },
        true
    );

    let lastBorderUpdate = 0;

    function borderUpdateLoop(timestamp) {
        if (
            chunkBordersEnabled &&
            timestamp - lastBorderUpdate > 150
        ) {
            lastBorderUpdate = timestamp;

            try {
                updateChunkBorders();
            } catch (error) {
                console.error(
                    "[MB F3] Yellow grid update error:",
                    error
                );
            }
        }

        requestAnimationFrame(
            borderUpdateLoop
        );
    }

    requestAnimationFrame(
        borderUpdateLoop
    );

    unsafeWindow.Miniblox.f3 = {
        reloadChunks,
        toggleHitboxes,
        copyPlayerCoords,
        clearChat,
        toggleChunkBorders,
        removeChunkBorders,
        openGamemodeMenu,
        closeGamemodeMenu,
        cycleGamemode,
        startPerformanceRecording,
        stopPerformanceRecording,
        togglePerformanceRecording,
        dumpVersionInfo,
        copyTargetedData,
        toggleSpectatorPrevious,
        toggleWireframe,
        showF3Help
    };

    chatMessage(
        "[F3] F3 Extension loaded — Press F3+Q to show hotkeys"
    );

})();
