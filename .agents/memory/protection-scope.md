---
name: Protection settings scope
description: Demo scope and schedule semantics for protection work
---

Keep protection settings shared for the demo account until a user/account ownership model is explicitly approved. Do not imply private per-user settings.

**Why:** The approved MVP uses a shared demo dashboard, with no sign-in or real banking integration. Introducing identity here would expand that scope.

**How to apply:** Future account persistence and purchase-protection work must use the same settings scope, or deliberately migrate it when ownership is introduced.

Interpret the daily block interval in the device's local clock, including the start hour and excluding the end hour. An end hour earlier than the start means the following day; equal hours are invalid, not a whole-day block.

**Why:** A definite convention prevents the settings screen and later purchase enforcement from disagreeing at midnight or at interval boundaries.

**How to apply:** Use this convention when the next phase applies blocking and cooldowns. Settings alone do not claim to enforce purchases.
