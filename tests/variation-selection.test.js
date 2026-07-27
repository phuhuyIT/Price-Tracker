const assert = require("node:assert/strict");

const {
  createVariationClicker,
} = require("../chrome-extension/shared/variation-page");
const {
  collectVariantResponses,
} = require("../chrome-extension/shared/variation-flow");

function selectedTiersKey(selectedTiers) {
  return Object.entries(selectedTiers)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([tier, option]) => `${tier}:${option}`)
    .join("|");
}

function createStatefulAdapter({
  availableCombinations,
  initialSelection,
}) {
  const available = new Set(
    availableCombinations.map(selectedTiersKey),
  );
  const selected = { ...initialSelection };
  const clicks = [];

  function isOptionEnabled(tierIndex, optionIndex) {
    const candidate = {
      ...selected,
      [tierIndex]: optionIndex,
    };

    return [...available].some((key) => {
      const combination = Object.fromEntries(
        key.split("|").map((entry) => {
          const [tier, option] = entry.split(":").map(Number);
          return [tier, option];
        }),
      );

      return Object.entries(candidate).every(
        ([tier, option]) =>
          combination[Number(tier)] === Number(option),
      );
    });
  }

  return {
    async click(tierIndex, optionIndex) {
      clicks.push([tierIndex, optionIndex]);

      if (selected[tierIndex] === optionIndex) {
        delete selected[tierIndex];
      } else {
        selected[tierIndex] = optionIndex;
      }
    },
    clicks,
    async locate(_definitions, tierIndex, optionIndex) {
      return {
        disabled: !isOptionEnabled(tierIndex, optionIndex),
        error: null,
        optionIndex,
        selected: selected[tierIndex] === optionIndex,
        tierIndex,
        x: tierIndex,
        y: optionIndex,
      };
    },
    async locateSelected() {
      return Object.entries(selected).map(([tier, option]) => ({
        disabled: false,
        optionIndex: Number(option),
        selected: true,
        tierIndex: Number(tier),
        x: Number(tier),
        y: Number(option),
      }));
    },
    selected,
    async wait() {},
  };
}

async function main() {
  const definitions = [
    { optionCount: 2 },
    { optionCount: 2 },
  ];
  const adapter = createStatefulAdapter({
    availableCombinations: [
      { 0: 0, 1: 0 },
      { 0: 1, 1: 1 },
    ],
    initialSelection: { 0: 0, 1: 0 },
  });
  const clicker = createVariationClicker(adapter, {
    clickDelayMs: 0,
  });

  const error = await clicker.clickCombination(definitions, {
    0: 1,
    1: 1,
  });

  assert.equal(error, null);
  assert.deepEqual(adapter.selected, { 0: 1, 1: 1 });
  assert.deepEqual(adapter.clicks, [
    [1, 0],
    [0, 0],
    [0, 1],
    [1, 1],
  ]);

  const unavailable = await clicker.clickCombination(definitions, {
    0: 1,
    1: 0,
  });

  assert.equal(
    unavailable.code,
    "VARIATION_COMBINATION_UNAVAILABLE",
  );
  assert.match(unavailable.message, /button 1:0 is disabled/);
  assert.deepEqual(adapter.selected, { 0: 1 });

  const diagnosticState = [{ className: "product-variation--selected" }];
  const diagnosticAdapter = createStatefulAdapter({
    availableCombinations: [{ 0: 0, 1: 0 }],
    initialSelection: {},
  });
  diagnosticAdapter.inspectState = async () => diagnosticState;
  const diagnosticClicker = createVariationClicker(
    diagnosticAdapter,
    {
      clickDelayMs: 0,
      includeDiagnostics: true,
    },
  );
  const diagnosticFailure =
    await diagnosticClicker.clickCombination(definitions, {
      0: 1,
      1: 1,
    });

  assert.equal(
    diagnosticFailure.code,
    "VARIATION_COMBINATION_UNAVAILABLE",
  );
  assert.deepEqual(diagnosticFailure.details, diagnosticState);

  const progress = [];
  const unavailableResponses = await collectVariantResponses({
    clicker: {
      async clickCombination() {
        return {
          code: "VARIATION_COMBINATION_UNAVAILABLE",
          message: "Target combination is unavailable.",
        };
      },
    },
    collector: {
      captured: new Map(),
      async stop() {},
      async waitFor() {},
    },
    definitions,
    onProgress(update) {
      progress.push(update);
    },
    requests: [
      {
        body: {},
        selectedTiers: { 0: 1, 1: 0 },
      },
    ],
  });

  assert.equal(unavailableResponses.length, 1);
  assert.equal(
    unavailableResponses[0].errorCode,
    "VARIATION_COMBINATION_UNAVAILABLE",
  );
  assert.deepEqual(progress, [
    {
      completed: 1,
      key: "0:1|1:0",
      outcome: "VARIATION_COMBINATION_UNAVAILABLE",
      total: 1,
    },
  ]);

  console.log("Variation-selection unit tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
