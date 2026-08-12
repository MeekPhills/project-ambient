#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const dataDirectory = process.env.AMBIENT_DATA_DIR;
const logPath = join(dataDirectory, "fixture-argv.jsonl");
appendFileSync(logPath, `${JSON.stringify(args)}\n`);

const statePath = join(dataDirectory, "fixture-state.json");
let state = { playbackStatus: "playing", powerPolicy: "automatic", channelId: "channel-beaches" };
try { state = JSON.parse(readFileSync(statePath, "utf8")); } catch {}

const channels = [
  {
    channel: {
      id: "channel-beaches",
      name: "Beaches",
      symbol: "water.waves",
      kind: "smart",
      includeTags: ["beach"],
      assetIDs: ["asset-sunrise"],
      isEnabled: true,
    },
    assetCount: 2,
    imageCount: 1,
    videoCount: 1,
  },
  {
    channel: {
      id: "channel-nature",
      name: "Nature",
      symbol: "leaf",
      kind: "manual",
      includeTags: ["nature"],
      assetIDs: [],
      isEnabled: true,
    },
    assetCount: 0,
    imageCount: 0,
    videoCount: 0,
  },
];

function channel(id = state.channelId) {
  return channels.find((item) => item.channel.id === id)?.channel;
}

function requestId() {
  const index = args.indexOf("--request-id");
  return index < 0 ? undefined : args[index + 1];
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function status() {
  return {
    ok: true,
    playbackStatus: state.playbackStatus,
    powerPolicy: state.powerPolicy,
    libraryFolderCount: 1,
    assetCount: 2,
    imageCount: 1,
    videoCount: 1,
    lastScanAt: "2026-08-12T14:00:00Z",
    status: {
      channel: channel(),
      now: {
        id: "asset-sunrise",
        path: "/private/secret/Sunrise.jpg",
        kind: "image",
        fileName: "Sunrise.jpg",
        tags: ["beach", "morning"],
        importedAt: "2026-08-10T12:00:00Z",
      },
      next: {
        id: "asset-wave",
        path: "/private/secret/Wave.mp4",
        kind: "video",
        fileName: "Wave.mp4",
        tags: ["beach"],
        importedAt: "2026-08-11T12:00:00Z",
        modifiedAt: "2026-08-12T12:00:00Z",
      },
      why: "You selected the Beaches channel.",
      isLowPowerModeEnabled: false,
      effectiveMode: state.powerPolicy === "efficiency" ? "still only" : "still + Aerial motion",
    },
  };
}

const mutation = (action, message, extra = {}) => ({
  ok: true,
  action,
  requestID: requestId(),
  message,
  ...extra,
});

if (args[0] === "status") {
  emit(status());
} else if (args[0] === "channels" && args[1] === "list") {
  emit({ ok: true, channels });
} else if (args[0] === "channels" && args[1] === "get") {
  const result = channels.find((item) => item.channel.id === args[2]);
  if (!result) {
    process.stderr.write(JSON.stringify({ ok: false, error: `No channel matches “${args[2]}”.` }));
    process.exitCode = 1;
  } else {
    emit({ ok: true, result });
  }
} else if (args[0] === "next") {
  emit(mutation("next", "Applied Sunrise.jpg to all displays.", { channel: channel() }));
} else if (args[0] === "activate") {
  state.channelId = args[1];
  state.playbackStatus = "playing";
  writeFileSync(statePath, JSON.stringify(state));
  emit(mutation("activate", `Activated ${channel()?.name}.`, { channel: channel() }));
} else if (args[0] === "pause") {
  state.playbackStatus = "paused";
  writeFileSync(statePath, JSON.stringify(state));
  emit(mutation("pause", args.includes("--duration") ? "Paused temporarily." : "Paused until you resume."));
} else if (args[0] === "resume") {
  state.playbackStatus = "playing";
  writeFileSync(statePath, JSON.stringify(state));
  emit(mutation("resume", "Background rotation resumed."));
} else if (args[0] === "power-policy" && args[1] === "set") {
  state.powerPolicy = args[2];
  writeFileSync(statePath, JSON.stringify(state));
  emit(mutation("set_power_policy", `Power policy set to ${args[2]}.`));
} else if (args[0] === "history") {
  emit({
    ok: true,
    items: [
      {
        position: 1,
        asset: {
          id: "asset-sunrise",
          path: "/private/secret/Sunrise.jpg",
          kind: "image",
          fileName: "Sunrise.jpg",
          tags: ["beach", "morning"],
          importedAt: "2026-08-10T12:00:00Z",
        },
      },
    ],
  });
} else if (args[0] === "restore") {
  state.channelId = null;
  state.playbackStatus = "paused";
  writeFileSync(statePath, JSON.stringify(state));
  emit(mutation("restore", "Restored the wallpapers that were active before Project Ambient."));
} else {
  process.stderr.write(JSON.stringify({ ok: false, error: "Unsupported fixture command." }));
  process.exitCode = 1;
}
