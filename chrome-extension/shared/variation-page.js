(function loadVariationPage(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ShopeeVariationPage = api;
  }
})(globalThis, function createVariationPage() {
  const DEFAULT_BUTTON_TIMEOUT_MS = 10_000;
  const DEFAULT_CLICK_DELAY_MS = 200;

  function findVariationButtonInPage(options) {
    const { definitions, optionIndex, tierIndex } = options;

    function isVisible(element) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    function toButton(element) {
      return (
        element.closest(
          "button, [role='button'], .product-variation",
        ) || element
      );
    }

    const totalOptions = definitions.reduce(
      (total, definition) => total + definition.optionCount,
      0,
    );
    const preferredButtons = Array.from(
      document.querySelectorAll(".product-variation"),
    ).filter(isVisible);
    let button = null;

    if (preferredButtons.length >= totalOptions) {
      const offset = definitions
        .slice(0, tierIndex)
        .reduce(
          (total, definition) => total + definition.optionCount,
          0,
        );
      button = preferredButtons[offset + optionIndex] || null;
    }

    if (!button) {
      const label = definitions[tierIndex]?.optionLabels[optionIndex];

      if (label) {
        const normalizedLabel = String(label)
          .trim()
          .toLocaleLowerCase();
        const candidates = Array.from(
          document.querySelectorAll(
            "button, [role='button'], label, .product-variation",
          ),
        ).filter(isVisible);

        button =
          candidates.find((candidate) => {
            const text = candidate.textContent
              .trim()
              .toLocaleLowerCase();
            const ariaLabel = (
              candidate.getAttribute("aria-label") || ""
            )
              .trim()
              .toLocaleLowerCase();
            return (
              text === normalizedLabel ||
              ariaLabel === normalizedLabel
            );
          }) || null;

        if (button) {
          button = toButton(button);
        }
      }
    }

    if (!button) {
      return {
        error: `Could not find variation button ${tierIndex}:${optionIndex}.`,
      };
    }

    button.scrollIntoView({
      block: "center",
      inline: "center",
    });
    const rect = button.getBoundingClientRect();
    const className =
      typeof button.className === "string" ? button.className : "";
    const disabled =
      button.disabled ||
      button.getAttribute("aria-disabled") === "true" ||
      className.includes("disabled");

    return {
      error: disabled
        ? `Variation button ${tierIndex}:${optionIndex} is disabled.`
        : null,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  function createVariationClicker(adapter, options = {}) {
    const buttonTimeoutMs =
      options.buttonTimeoutMs ?? DEFAULT_BUTTON_TIMEOUT_MS;
    const clickDelayMs =
      options.clickDelayMs ?? DEFAULT_CLICK_DELAY_MS;

    async function clickButton(definitions, tierIndex, optionIndex) {
      const deadline = Date.now() + buttonTimeoutMs;
      let button;

      do {
        button = await adapter.locate(
          definitions,
          tierIndex,
          optionIndex,
        );

        if (!button?.error || !button.error.startsWith("Could not find")) {
          break;
        }

        await adapter.wait(clickDelayMs);
      } while (Date.now() < deadline);

      if (button?.error) {
        return button.error;
      }

      await adapter.click(button.x, button.y);
      await adapter.wait(clickDelayMs);
      return null;
    }

    async function clickCombination(definitions, selectedTiers) {
      for (const [tier, option] of Object.entries(selectedTiers)) {
        const error = await clickButton(
          definitions,
          Number(tier),
          Number(option),
        );

        if (error) {
          return error;
        }
      }

      return null;
    }

    async function forceCombinationRequest(
      definitions,
      selectedTiers,
    ) {
      const targetError = await clickCombination(
        definitions,
        selectedTiers,
      );

      if (targetError) {
        return targetError;
      }

      for (const [tier, targetOption] of Object.entries(selectedTiers)) {
        const definition = definitions[Number(tier)];

        for (
          let alternativeOption = 0;
          alternativeOption < (definition?.optionCount || 0);
          alternativeOption += 1
        ) {
          if (alternativeOption === Number(targetOption)) {
            continue;
          }

          const alternativeError = await clickButton(
            definitions,
            Number(tier),
            alternativeOption,
          );

          if (alternativeError) {
            continue;
          }

          return clickButton(
            definitions,
            Number(tier),
            Number(targetOption),
          );
        }
      }

      return "The selected variation has no alternative option to toggle.";
    }

    return {
      clickCombination,
      forceCombinationRequest,
    };
  }

  return {
    createVariationClicker,
    findVariationButtonInPage,
  };
});
