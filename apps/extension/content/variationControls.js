const VARIATION_SELECTOR = "button, [role='button'], .product-variation";

function isVisible(element) {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
  );
}

function toButton(element) {
  return element.closest(VARIATION_SELECTOR) ?? element;
}

function isSelected(element) {
  const relatedElements = [element, element.parentElement, ...element.querySelectorAll('*')].filter(
    Boolean,
  );

  return relatedElements.some((candidate) => {
    const className = typeof candidate.className === 'string' ? candidate.className : '';
    const classTokens = className.split(/\s+/u);

    return (
      candidate.getAttribute('aria-pressed') === 'true' ||
      candidate.getAttribute('aria-selected') === 'true' ||
      candidate.getAttribute('data-selected') === 'true' ||
      classTokens.some(
        (token) =>
          token === 'selected' ||
          (/(?:^|[-_])selected$/u.test(token) && !/(?:^|[-_])unselected$/u.test(token)),
      )
    );
  });
}

function describeButton(button, tierIndex, optionIndex) {
  const rect = button.getBoundingClientRect();
  const className = typeof button.className === 'string' ? button.className : '';

  return {
    disabled:
      Boolean(button.disabled) ||
      button.getAttribute('aria-disabled') === 'true' ||
      className.includes('disabled'),
    error: null,
    optionIndex,
    selected: isSelected(button),
    tierIndex,
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

/** Locate one rendered Shopee variation control by tier and option index. */
export function findVariationButtonInPage({ definitions, optionIndex, tierIndex }) {
  const totalOptions = definitions.reduce((total, definition) => total + definition.optionCount, 0);
  const preferredButtons = Array.from(document.querySelectorAll('.product-variation')).filter(
    isVisible,
  );
  let button = null;

  if (preferredButtons.length >= totalOptions) {
    const offset = definitions
      .slice(0, tierIndex)
      .reduce((total, definition) => total + definition.optionCount, 0);
    button = preferredButtons[offset + optionIndex] ?? null;
  }

  if (!button) {
    const label = definitions[tierIndex]?.optionLabels[optionIndex];

    if (label) {
      const normalisedLabel = String(label).trim().toLocaleLowerCase();
      const candidates = Array.from(document.querySelectorAll(VARIATION_SELECTOR)).filter(
        isVisible,
      );

      button =
        candidates.find((candidate) => {
          const text = candidate.textContent.trim().toLocaleLowerCase();
          const ariaLabel = (candidate.getAttribute('aria-label') ?? '').trim().toLocaleLowerCase();
          return text === normalisedLabel || ariaLabel === normalisedLabel;
        }) ?? null;

      if (button) {
        button = toButton(button);
      }
    }
  }

  if (!button) {
    return { error: `Could not find variation button ${tierIndex}:${optionIndex}.` };
  }

  button.scrollIntoView({ block: 'center', inline: 'center' });
  return describeButton(button, tierIndex, optionIndex);
}

/** Return the currently selected rendered control for every detected tier. */
export function findSelectedVariationButtonsInPage({ definitions }) {
  const buttons = Array.from(document.querySelectorAll('.product-variation')).filter(isVisible);
  const selected = [];
  let optionOffset = 0;

  for (let tierIndex = 0; tierIndex < definitions.length; tierIndex += 1) {
    const optionCount = definitions[tierIndex]?.optionCount ?? 0;

    for (let optionIndex = 0; optionIndex < optionCount; optionIndex += 1) {
      const button = buttons[optionOffset + optionIndex];

      if (button && isSelected(button)) {
        selected.push(describeButton(button, tierIndex, optionIndex));
      }
    }

    optionOffset += optionCount;
  }

  if (selected.length > 0) {
    return selected;
  }

  const candidates = Array.from(document.querySelectorAll(VARIATION_SELECTOR)).filter(isVisible);

  for (let tierIndex = 0; tierIndex < definitions.length; tierIndex += 1) {
    const labels = definitions[tierIndex]?.optionLabels ?? [];

    for (let optionIndex = 0; optionIndex < labels.length; optionIndex += 1) {
      const normalisedLabel = String(labels[optionIndex]).trim().toLocaleLowerCase();
      const candidate = candidates.find((element) => {
        const text = element.textContent.trim().toLocaleLowerCase();
        const ariaLabel = (element.getAttribute('aria-label') ?? '').trim().toLocaleLowerCase();
        return text === normalisedLabel || ariaLabel === normalisedLabel;
      });
      const button = candidate ? toButton(candidate) : null;

      if (button && isSelected(button)) {
        selected.push(describeButton(button, tierIndex, optionIndex));
      }
    }
  }

  return selected;
}

/** Build the sequential click/reset adapter used by background collection. */
export function createVariationClicker(adapter, options = {}) {
  const buttonTimeoutMs = options.buttonTimeoutMs ?? 10_000;
  const clickDelayMs = options.clickDelayMs ?? 200;

  function failure(code, message) {
    return { code, details: null, message };
  }

  async function clickCoordinates(button) {
    await adapter.click(button.x, button.y);
    await adapter.wait(clickDelayMs);
  }

  async function clickButton(definitions, tierIndex, optionIndex) {
    const deadline = Date.now() + buttonTimeoutMs;
    let button;

    do {
      button = await adapter.locate(definitions, tierIndex, optionIndex);

      if (!button?.error || !button.error.startsWith('Could not find')) {
        break;
      }

      await adapter.wait(clickDelayMs);
    } while (Date.now() < deadline);

    if (button?.error) {
      return failure('VARIATION_BUTTON_NOT_FOUND', button.error);
    }

    if (!button) {
      return failure(
        'VARIATION_BUTTON_NOT_FOUND',
        `Could not find variation button ${tierIndex}:${optionIndex}.`,
      );
    }

    if (button.disabled) {
      return failure(
        'VARIATION_BUTTON_DISABLED',
        `Variation button ${tierIndex}:${optionIndex} is disabled.`,
      );
    }

    await clickCoordinates(button);
    return null;
  }

  async function locateSelectedButtons(definitions) {
    if (typeof adapter.locateSelected === 'function') {
      const selected = await adapter.locateSelected(definitions);

      if (Array.isArray(selected)) {
        return selected;
      }
    }

    const selected = [];

    for (let tierIndex = 0; tierIndex < definitions.length; tierIndex += 1) {
      const definition = definitions[tierIndex];

      for (let optionIndex = 0; optionIndex < (definition?.optionCount ?? 0); optionIndex += 1) {
        const button = await adapter.locate(definitions, tierIndex, optionIndex);

        if (button?.selected) {
          selected.push({ ...button, optionIndex, tierIndex });
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
        .map((button) => `${button.tierIndex}:${button.optionIndex}`)
        .sort()
        .join('|');

      if (selectionKey === previousSelectionKey) {
        return failure(
          'VARIATION_SELECTION_RESET_FAILED',
          'Shopee kept the same variation selected after it was clicked.',
        );
      }

      const button = [...selected].sort((left, right) => right.tierIndex - left.tierIndex)[0];

      if (button.disabled) {
        return failure(
          'VARIATION_SELECTION_RESET_FAILED',
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
          'VARIATION_SELECTION_RESET_FAILED',
          'Shopee variation selections could not be cleared.',
        );
  }

  async function clickCombination(definitions, selectedTiers, clickOptions = {}) {
    if (clickOptions.reset !== false) {
      const resetError = await clearSelections(definitions);

      if (resetError) {
        return resetError;
      }
    }

    for (const [tier, option] of Object.entries(selectedTiers)) {
      const error = await clickButton(definitions, Number(tier), Number(option));

      if (error?.code === 'VARIATION_BUTTON_DISABLED') {
        return failure(
          'VARIATION_COMBINATION_UNAVAILABLE',
          `Target combination cannot be selected because ${error.message}`,
        );
      }

      if (error) {
        return error;
      }
    }

    return null;
  }

  async function forceCombinationRequest(definitions, selectedTiers) {
    const targetError = await clickCombination(definitions, selectedTiers);

    if (targetError) {
      return targetError;
    }

    for (const [tier, targetOption] of Object.entries(selectedTiers)) {
      const definition = definitions[Number(tier)];

      for (
        let alternativeOption = 0;
        alternativeOption < (definition?.optionCount ?? 0);
        alternativeOption += 1
      ) {
        if (alternativeOption === Number(targetOption)) {
          continue;
        }

        const alternativeError = await clickButton(definitions, Number(tier), alternativeOption);

        if (!alternativeError) {
          return clickButton(definitions, Number(tier), Number(targetOption));
        }
      }
    }

    return failure(
      'VARIATION_REQUEST_NOT_TRIGGERED',
      'The selected variation has no alternative option to toggle.',
    );
  }

  return Object.freeze({ clearSelections, clickCombination, forceCombinationRequest });
}
