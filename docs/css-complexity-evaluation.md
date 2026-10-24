# CSS Path Complexity Evaluation Specification

## 1. Introduction

This document specifies the procedure to build a CSS path complexity evaluation library.

The goal of this library is simple. When the library receives a CSS path string as input, it must estimate the complexity of the path. The library must return a numerical value. Developers use this value to detect expensive selectors.

The library must execute fast. The library does not need to be fool-proof. Ballpark estimates are acceptable. Avoid assumptions during the implementation. You must collect all data from your production environment and official specifications.

## 2. Data Collection

You must create a complete dictionary of valid CSS tokens.

1. Read the W3C Selectors Level 4 Specification.
2. Read the MDN Web Docs for CSS selectors.
3. Extract all valid CSS selectors, combinators, pseudo-classes, and pseudo-elements.
4. Add these items to your dictionary.
5. If the sources conflict, use the W3C Specification.

## 3. Environment Profiling

Do not assume the size of the target Document Object Model (DOM). You must measure it.

1. Scan your production target web pages.
2. Measure the maximum DOM node count across all pages.
3. Measure the maximum DOM depth across all pages.
4. Build a synthetic benchmark DOM tree.
5. Make the benchmark tree match the measured maximum node count.
6. Make the benchmark tree match the measured maximum depth.

Do not assume a fixed number of benchmark iterations. 

1. Write a script to measure the execution time of a CSS selector.
2. Increase the number of benchmark iterations dynamically.
3. Stop the iterations when the standard deviation of the execution time stabilizes below a one percent variance.

## 4. Performance Measurement

You must measure the performance of the CSS tokens.

1. Run the benchmark natively in your target browser engine.
2. Measure the mean execution time of a single Class selector on the synthetic DOM.
3. Record this value as the BaselineTime.
4. Measure the mean execution time of every other token in your dictionary.
5. Record each value as the TokenTime.

## 5. Weight Derivation

You must calculate a relative weight for each token.

1. Calculate the weight using this formula: Weight = TokenTime / BaselineTime.
2. Round the Weight to the nearest integer.
3. Store the Weight for each token in your dictionary.

## 6. Library Implementation

You must build the library to evaluate paths against the dictionary. The internal parsing mechanism is your choice. 

1. Accept a CSS path string as input.
2. Identify the known tokens within the CSS path string.
3. Match the identified tokens against your dictionary.
4. Sum the Weight of each identified token to compute the TotalPathCost.
5. Return the TotalPathCost.

Do not assume a fallback penalty for unknown tokens.

1. Identify the maximum Weight in your dictionary.
2. Multiply this maximum Weight by ten to calculate the FallbackWeight.
3. If your parsing mechanism identifies an unknown token, assign the FallbackWeight to that token.
4. Output a string to standard error (stderr) when the library applies a FallbackWeight.
5. Include the unknown token and the FallbackWeight in the output string.
