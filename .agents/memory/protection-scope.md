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

In this MVP, a purchase started during protected hours waits for a cooldown, then can proceed after two awareness answers; protected hours are not an absolute ban. Either yes/no answer is valid. Postponement ends that attempt without scheduling an automatic purchase.

**Why:** The approved scope is a reflective purchase simulation, not a payment-blocking system or an automated purchase scheduler.

**How to apply:** Keep final decisions terminal and don't reinterpret postponement as authorization to execute later. Changes to protection settings affect new attempts, not cooldowns already started.
