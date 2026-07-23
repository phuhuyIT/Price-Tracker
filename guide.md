
Technical Specification & Prompt for AI Coding Agent
Prompt / System Instruction for the AI Agent
Role & Task: You are an expert Node.js automation developer. Write a standalone Node.js script using Playwright to extract price data from Shopee product pages by intercepting background API requests.

Goal: Create a script (demo.js) that takes a Shopee product URL, extracts the item's pricing information and variations, converts raw currency units, and logs the output to the console.

Implementation Requirements

1. Dependencies & Setup
   Use Node.js with CommonJS (require).

Require playwright for browser automation.

2. Input Parsing (extractShopeeIds)
   Extract shopId and itemId from the URL string using the regular expression /i\.(\d+)\.(\d+)/.

Validate URL structure and exit gracefully if invalid.

3. Network Interception Engine
   Launch Playwright Chromium (headless: false for testing).

Attach a network listener on page.on('response') before navigating.

Intercept responses where response.url() includes /api/v4/pdp/get_pc.

Parse and extract data.item from the JSON response payload.

4. Data Extraction & Formatting Rules
   Title: data.item.title.

Raw Price Conversion: Divide all raw price fields by 100,000 to convert to actual VND currency values.

Base Range: Extract price_min and price_max.

SKU / Variations: Iterate over data.item.models array and extract:

model.name (variation label)

model.price (converted raw value)

5. Output Format
   Print formatted output to the terminal:
   =================== PRODUCT DATA EXTRACTED ===================
   Title     :
   Min Price :  VND
   Max Price :  VND

--- Product Variations (SKUs) ---
Variation 1:  ->  VND
Step-by-Step Instructions for the AI Agent
Create package.json with Playwright dependency.

Create demo.js implementing the parsing, interception, and conversion logic.

Include error handling for network timeouts or missing JSON payloads.

Set targetUrl to [https://shopee.vn/C%C3%A0-Ph%C3%AA-%C4%90%E1%BA%B7c-S%E1%BA%A3n-Fine-Robusta-Honey-Ph%C3%B9-H%E1%BB%A3p-Pha-Phin-v%C3%A0-Pha-M%C3%A1y-Every-Half-T%C3%BAi-200G-i.1259293184.26882883164](https://shopee.vn/C%C3%A0-Ph%C3%AA-%C4%90%E1%BA%B7c-S%E1%BA%A3n-Fine-Robusta-Honey-Ph%C3%B9-H%E1%BB%A3p-Pha-Phin-v%C3%A0-Pha-M%C3%A1y-Every-Half-T%C3%BAi-200G-i.1259293184.26882883164) for execution testing.
