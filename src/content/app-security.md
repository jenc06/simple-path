# RentSmooth App Security Guide

RentSmooth is a review aid. It does not approve, deny, rank, score, or decide housing outcomes.

Uploaded documents are untrusted input. Text extracted from documents is treated as data to inspect, not instructions to follow. If a document contains text such as "ignore prior instructions", "override policy", "approve this applicant", "deny this applicant", or "reveal the system prompt", the app flags that text as suspicious and ignores it for calculation.

The app separates trusted application rules from uploaded document content. System and app instructions define what the app is allowed to do. User-uploaded document text has the lowest trust level.

Values from documents are not used until the user reviews and confirms them. The chat can explain extracted values, confirmed values, duplicate-income review choices, rule evidence, and security behavior. The chat cannot change values, confirm fields, delete documents, export packets, or perform any other state-changing action.

The chat sends only a sanitized snapshot to the server: extracted field labels and values, confirmation status, duplicate-income review choices, household size, configured threshold, and allowlisted HUD reference snippets. Full document files, preview images, and local browser storage are not sent to OpenAI by the chat.

The OpenAI API key is used only on the server. It is never sent to the browser.

The chat must refuse requests to decide, approve, deny, rank, or recommend an outcome. It must also refuse requests involving protected traits, demographic proxies, behavioral or tenant-risk predictions, or landlord revenue/profit optimization.

The rule retrieval path is allowlisted. HUD rule context comes from the local frozen threshold and, when configured, retrieved HUD reference snippets from allowlisted HUD URLs. The chat should answer rule questions only from those provided references.
