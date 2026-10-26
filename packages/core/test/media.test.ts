import assert from "node:assert/strict";
import { test } from "node:test";
import { actOn, agenda, basicCatalog, lowerSurface, playbackKey, projectText, resolveAnswer, SurfaceStore } from "../src/index.ts";

test("media aliases preserve type and content across screen, voice agenda and text targets", () => {
  const store = new SurfaceStore(basicCatalog);
  const issues = store.render({ surface: "clip", nodes: [{ id: "root", type: "video", props: { src: "media:private-file", title: "Garden", description: "A five second clip", transcript: "Birds singing" } }] });
  assert.deepEqual(issues, []);
  const resolved = store.resolve("clip")!;
  assert.equal(resolved.root!.type, "media");
  assert.equal(resolved.root!.props.kind, "video");
  assert.match(projectText(resolved), /Garden/);
  assert.match(projectText(lowerSurface(resolved)), /Birds singing/);
  assert.doesNotMatch(projectText(lowerSurface(resolved)), /media:private-file/);
  const item = agenda(store, "clip")[0]!;
  assert.equal(item.kind, "decision");
  if (item.kind !== "decision") throw new Error("missing playback decision");
  assert.deepEqual(resolveAnswer(item, "pause"), { kind: "choose", index: 1 });
  assert.deepEqual(playbackKey(item.options[1]!.source), { node: "root", command: "pause" });
  const action = actOn(store, item, 1);
  assert.equal(action.action, undefined);
  assert.match(Object.values(action.errors).flat().join(" "), /local projector/);
});

test("a media image has an accessible description without playback choices", () => {
  const store = new SurfaceStore(basicCatalog);
  assert.deepEqual(store.render({ surface: "image", nodes: [{ id: "root", type: "media", props: { kind: "image", src: "media:asset", title: "Poster", alt: "A red bird" } }] }), []);
  assert.deepEqual(agenda(store, "image"), []);
  assert.match(projectText(store.resolve("image")!), /Poster/);
  assert.equal(playbackKey("root#media-publish"), undefined);
  assert.equal(playbackKey("#media-play"), undefined);
});
