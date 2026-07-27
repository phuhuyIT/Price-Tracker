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
    const classTokens = className.split(/\s+/);
    const selected =
      button.getAttribute("aria-pressed") === "true" ||
      button.getAttribute("aria-selected") === "true" ||
      button.getAttribute("data-selected") === "true" ||
      classTokens.some(
        (token) =>
          token === "selected" ||
          (/(?:^|[-_])selected$/.test(token) &&
            !/(?:^|[-_])unselected$/.test(token)),
      );
    const disabled =
      button.disabled ||
      button.getAttribute("aria-disabled") === "true" ||
      className.includes("disabled");

    return {
      disabled,
      error: null,
      optionIndex,
      selected,
      tierIndex,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  function findSelectedVariationButtonsInPage(options) {
    const { definitions } = options;

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

    function isSelected(button) {
      const relatedElements = [
        button,
        button.parentElement,
        ...button.querySelectorAll("*"),
      ].filter(Boolean);

      return relatedElements.some((element) => {
        const className =
          typeof element.className === "string"
            ? element.className
            : "";
        const classTokens = className.split(/\s+/);

        return (
          element.getAttribute("aria-pressed") === "true" ||
          element.getAttribute("aria-selected") === "true" ||
          element.getAttribute("data-selected") === "true" ||
          classTokens.some(
            (token) =>
              token === "selected" ||
              (/(?:^|[-_])selected$/.test(token) &&
                !/(?:^|[-_])unselected$/.test(token)),
          )
        );
      });
    }

    function toButton(element) {
      return (
        element.closest(
          "button, [role='button'], .product-variation",
        ) || element
      );
    }

    const buttons = Array.from(
      document.querySelectorAll(".product-variation"),
    ).filter(isVisible);

    const preferredSelections = buttons.flatMap(
      (button, buttonIndex) => {
        if (!isSelected(button)) {
          return [];
        }

        let optionOffset = 0;
        let tierIndex = -1;
        let optionIndex = -1;

        for (
          let definitionIndex = 0;
          definitionIndex < definitions.length;
          definitionIndex += 1
        ) {
          const optionCount =
            definitions[definitionIndex]?.optionCount || 0;

          if (
            buttonIndex >= optionOffset &&
            buttonIndex < optionOffset + optionCount
          ) {
            tierIndex = definitionIndex;
            optionIndex = buttonIndex - optionOffset;
            break;
          }

          optionOffset += optionCount;
        }

        if (tierIndex < 0 || optionIndex < 0) {
          return [];
        }

        const rect = button.getBoundingClientRect();
        const className =
          typeof button.className === "string" ? button.className : "";

        return [
          {
            disabled:
              button.disabled ||
              button.getAttribute("aria-disabled") === "true" ||
              className.includes("disabled"),
            optionIndex,
            selected: true,
            tierIndex,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          },
        ];
      },
    );

    if (preferredSelections.length > 0) {
      return preferredSelections;
    }

    const candidates = Array.from(
      document.querySelectorAll(
        "button, [role='button'], label, .product-variation",
      ),
    ).filter(isVisible);
    const selected = [];

    for (
      let tierIndex = 0;
      tierIndex < definitions.length;
      tierIndex += 1
    ) {
      const labels = definitions[tierIndex]?.optionLabels || [];

      for (
        let optionIndex = 0;
        optionIndex < labels.length;
        optionIndex += 1
      ) {
        const normalizedLabel = String(labels[optionIndex])
          .trim()
          .toLocaleLowerCase();
        const candidate = candidates.find((element) => {
          const text = element.textContent
            .trim()
            .toLocaleLowerCase();
          const ariaLabel = (
            element.getAttribute("aria-label") || ""
          )
            .trim()
            .toLocaleLowerCase();
          return (
            text === normalizedLabel ||
            ariaLabel === normalizedLabel
          );
        });

        if (!candidate) {
          continue;
        }

        const button = toButton(candidate);

        if (!isSelected(button)) {
          continue;
        }

        const rect = button.getBoundingClientRect();
        const className =
          typeof button.className === "string"
            ? button.className
            : "";
        selected.push({
          disabled:
            button.disabled ||
            button.getAttribute("aria-disabled") === "true" ||
            className.includes("disabled"),
          optionIndex,
          selected: true,
          tierIndex,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        });
      }
    }

    return selected;
  }

  function inspectVariationButtonsInPage(options) {
    const { definitions = [] } = options;

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

    function classNameOf(element) {
      return typeof element?.className === "string"
        ? element.className
        : "";
    }

    function describeElement(element) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const beforeStyle = getComputedStyle(element, "::before");
      const afterStyle = getComputedStyle(element, "::after");

      return {
        afterContent: afterStyle.content,
        ariaDisabled: element.getAttribute("aria-disabled"),
        ariaPressed: element.getAttribute("aria-pressed"),
        ariaSelected: element.getAttribute("aria-selected"),
        backgroundColor: style.backgroundColor,
        beforeContent: beforeStyle.content,
        borderColor: style.borderColor,
        childClassNames: Array.from(
          element.querySelectorAll("*"),
        )
          .map(classNameOf)
          .filter(Boolean)
          .slice(0, 10),
        className: classNameOf(element),
        dataSelected: element.getAttribute("data-selected"),
        disabled: Boolean(element.disabled),
        height: Math.round(rect.height),
        parentClassName: classNameOf(element.parentElement),
        tagName: element.tagName.toLocaleLowerCase(),
        text: element.textContent.trim().slice(0, 120),
        visible: isVisible(element),
        width: Math.round(rect.width),
      };
    }

    const optionLabels = new Set(
      definitions.flatMap((definition) =>
        (definition?.optionLabels || []).map((label) =>
          String(label).trim().toLocaleLowerCase(),
        ),
      ),
    );
    const allCandidates = Array.from(
      document.querySelectorAll(
        "button, [role='button'], label, .product-variation",
      ),
    );
    const exactCandidates = allCandidates.filter((element) => {
      const text = element.textContent
        .trim()
        .toLocaleLowerCase();
      const ariaLabel = (
        element.getAttribute("aria-label") || ""
      )
        .trim()
        .toLocaleLowerCase();

      return (
        optionLabels.size === 0 ||
        optionLabels.has(text) ||
        optionLabels.has(ariaLabel)
      );
    });
    const allElements = Array.from(
      document.querySelectorAll("body *"),
    );
    const exactTextElements = allElements.filter((element) =>
      optionLabels.has(
        element.textContent.trim().toLocaleLowerCase(),
      ),
    );
    const selectedLikeElements = allElements.filter((element) => {
      const className = classNameOf(element);
      return (
        element.getAttribute("aria-pressed") === "true" ||
        element.getAttribute("aria-selected") === "true" ||
        element.getAttribute("data-selected") === "true" ||
        /selected/i.test(className)
      );
    });
    const preferredButtons = Array.from(
      document.querySelectorAll(".product-variation"),
    );

    return {
      counts: {
        allCandidates: allCandidates.length,
        exactCandidates: exactCandidates.length,
        exactTextElements: exactTextElements.length,
        preferredButtons: preferredButtons.length,
        selectedLikeElements: selectedLikeElements.length,
        visibleCandidates: allCandidates.filter(isVisible).length,
        visiblePreferredButtons:
          preferredButtons.filter(isVisible).length,
      },
      exactCandidates:
        exactCandidates.slice(0, 100).map(describeElement),
      exactTextElements:
        exactTextElements.slice(0, 100).map(describeElement),
      selectedLikeElements:
        selectedLikeElements.slice(0, 100).map(describeElement),
    };
  }

  function createVariationClicker(adapter, options = {}) {
    const buttonTimeoutMs =
      options.buttonTimeoutMs ?? DEFAULT_BUTTON_TIMEOUT_MS;
    const clickDelayMs =
      options.clickDelayMs ?? DEFAULT_CLICK_DELAY_MS;
    const includeDiagnostics =
      options.includeDiagnostics === true;

    function failure(code, message, details = null) {
      return { code, details, message };
    }

    async function clickCoordinates(button) {
      await adapter.click(button.x, button.y);
      await adapter.wait(clickDelayMs);
    }

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
        return failure("VARIATION_BUTTON_NOT_FOUND", button.error);
      }

      if (!button) {
        return failure(
          "VARIATION_BUTTON_NOT_FOUND",
          `Could not find variation button ${tierIndex}:${optionIndex}.`,
        );
      }

      if (button.disabled) {
        return failure(
          "VARIATION_BUTTON_DISABLED",
          `Variation button ${tierIndex}:${optionIndex} is disabled.`,
        );
      }

      await clickCoordinates(button);
      return null;
    }

    async function locateSelectedButtons(definitions) {
      if (typeof adapter.locateSelected === "function") {
        const selected = await adapter.locateSelected(definitions);

        if (Array.isArray(selected)) {
          return selected;
        }
      }

      const selected = [];

      for (
        let tierIndex = 0;
        tierIndex < definitions.length;
        tierIndex += 1
      ) {
        const definition = definitions[tierIndex];

        for (
          let optionIndex = 0;
          optionIndex < (definition?.optionCount || 0);
          optionIndex += 1
        ) {
          const button = await adapter.locate(
            definitions,
            tierIndex,
            optionIndex,
          );

          if (button?.selected) {
            selected.push({
              ...button,
              optionIndex,
              tierIndex,
            });
          }
        }
      }

      return selected;
    }

    async function clearSelections(definitions) {
      const maximumClicks = Math.max(definitions.length * 2, 1);
      let previousSelectionKey = null;

      for (let attempt = 0; attempt < maximumClicks; attempt += 1) {
        const selected = await locateSelectedButtons(definitions);

        if (selected.length === 0) {
          return null;
        }

        const selectionKey = selected
          .map(
            (button) => `${button.tierIndex}:${button.optionIndex}`,
          )
          .sort()
          .join("|");

        if (selectionKey === previousSelectionKey) {
          return failure(
            "VARIATION_SELECTION_RESET_FAILED",
            "Shopee kept the same variation selected after it was clicked.",
          );
        }

        const button = [...selected].sort(
          (left, right) => right.tierIndex - left.tierIndex,
        )[0];

        if (button.disabled) {
          return failure(
            "VARIATION_SELECTION_RESET_FAILED",
            `Selected variation button ${button.tierIndex}:${button.optionIndex} is disabled and cannot be cleared.`,
          );
        }

        previousSelectionKey = selectionKey;
        await clickCoordinates(button);
      }

      const remaining = await locateSelectedButtons(definitions);

      return remaining.length === 0
        ? null
        : failure(
            "VARIATION_SELECTION_RESET_FAILED",
            "Shopee variation selections could not be cleared.",
          );
    }

    async function clickCombination(
      definitions,
      selectedTiers,
      clickOptions = {},
    ) {
      if (clickOptions.reset !== false) {
        const resetError = await clearSelections(definitions);

        if (resetError) {
          return resetError;
        }
      }

      for (const [tier, option] of Object.entries(selectedTiers)) {
        const error = await clickButton(
          definitions,
          Number(tier),
          Number(option),
        );

        if (error) {
          if (error.code === "VARIATION_BUTTON_DISABLED") {
            const details =
              includeDiagnostics &&
              typeof adapter.inspectState === "function"
                ? await adapter.inspectState(definitions)
                : null;
            return failure(
              "VARIATION_COMBINATION_UNAVAILABLE",
              `Target combination cannot be selected because ${error.message}`,
              details,
            );
          }

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

      return failure(
        "VARIATION_REQUEST_NOT_TRIGGERED",
        "The selected variation has no alternative option to toggle.",
      );
    }

    return {
      clearSelections,
      clickCombination,
      forceCombinationRequest,
    };
  }

  return {
    createVariationClicker,
    findSelectedVariationButtonsInPage,
    findVariationButtonInPage,
    inspectVariationButtonsInPage,
  };
});
