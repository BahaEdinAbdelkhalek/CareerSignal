"use strict";

// Importing these modules registers all CareerSignal functions with the
// Azure Functions Node.js v4 programming model.
require("./functions/start-career-signal");
require("./functions/careersignal-orchestrator");
require("./functions/company-discovery");
require("./functions/hr-contact-discovery");
require("./functions/email-enrichment");
require("./functions/foundry-activity");
require("./functions/retention");
require("./functions/delete-career-signal");
