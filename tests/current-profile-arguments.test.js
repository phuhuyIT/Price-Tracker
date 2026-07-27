const assert = require("node:assert/strict");

const { parseArguments } = require("../current-profile");

function main() {
  const parsed = parseArguments([
    "https://shopee.vn/product-i.760215.23307713229",
    "--fixture",
    "tests/fixtures/capture.json",
    "--timeout=120000",
    "--model-id",
    "257921564639",
    "--model-id=257921564637",
    "--model-id",
    "257921564639",
  ]);

  assert.equal(parsed.bridgeTimeoutMs, 120_000);
  assert.equal(parsed.fixturePath, "tests/fixtures/capture.json");
  assert.deepEqual(parsed.modelIds, [
    "257921564639",
    "257921564637",
  ]);

  assert.throws(
    () => parseArguments(["--model-id", "not-a-number"]),
    /numeric Shopee model ID/,
  );
  assert.throws(
    () => parseArguments(["--fixture="]),
    /destination path/,
  );

  console.log("Current-profile argument tests passed");
}

main();
