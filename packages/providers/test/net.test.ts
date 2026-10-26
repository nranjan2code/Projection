import assert from "node:assert/strict";
import { test } from "node:test";
import { isPublicAddress, isPublicHttpsUrl, pinnedFetch } from "../src/net.ts";

// A fetch named by a model must not reach this machine's network. An IPv6
// address that carries an IPv4 one is the easy way past a prefix check: on a
// NAT64 network 64:ff9b::a9fe:a9fe is 169.254.169.254, 2002:7f00:1:: is 6to4
// for 127.0.0.1, and ::ffff:10.0.0.1 is a mapped private address.

test("private and loopback IPv4 addresses are not public", () => {
  for (const address of ["127.0.0.1", "127.1.2.3", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "203.0.113.9"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

test("an IPv6 address that carries an IPv4 one is only as public as what it carries", () => {
  const blocked = ["::", "::1", "::127.0.0.1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "2002:7f00:1::1", "2002:a9fe:a9fe::1", "fd00::1", "fe80::1", "2001:0000:4136:e378::1"];
  for (const address of blocked) assert.equal(isPublicAddress(address), false, address);
  const allowed = ["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1"];
  for (const address of allowed) assert.equal(isPublicAddress(address), true, address);
});

test("only https, no credentials, and no name that resolves to a private address", async () => {
  assert.equal(await isPublicHttpsUrl("http://example.com/"), false);
  assert.equal(await isPublicHttpsUrl("https://user:pass@example.com/"), false);
  assert.equal(await isPublicHttpsUrl("https://localhost/"), false);
  assert.equal(await isPublicHttpsUrl("https://127.0.0.1/"), false);
  assert.equal(await isPublicHttpsUrl("https://[::1]/"), false);
});

test("pinnedFetch refuses the address it just resolved instead of asking DNS again", async () => {
  // A resolver that answers 127.0.0.1 is exactly the rebinding case: the URL
  // looks public, and a second lookup would be the one that gets through.
  await assert.rejects(
    pinnedFetch("https://looks-public.example/", { resolve: async () => [{ address: "127.0.0.1", family: 4 }] }),
    /not a public address/,
  );
  // One private address among several is enough to refuse: the connection
  // could be the one that picks it.
  await assert.rejects(
    pinnedFetch("https://mixed.example/", { resolve: async () => [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }] }),
    /not a public address/,
  );
  await assert.rejects(
    pinnedFetch("https://mapped.example/", { resolve: async () => [{ address: "::ffff:169.254.169.254", family: 6 }] }),
    /not a public address/,
  );
});
