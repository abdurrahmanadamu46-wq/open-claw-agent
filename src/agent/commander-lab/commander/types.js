/**
 * @typedef {"signal_scan"|"strategy_design"|"content_production"|"interaction_handling"|"lead_qualification"|"conversion_push"|"recovery_replay"|"review_evolution"} MissionType
 */

/**
 * @typedef {"L0"|"L1"|"L2"|"L3"} RiskLevel
 */

/**
 * @typedef {"low"|"normal"|"high"|"urgent"} LatencyPriority
 */

/**
 * @typedef {"low"|"medium"|"high"|"strategic"} RevenueImpact
 */

/**
 * @typedef {"low"|"medium"|"high"} EvidenceSufficiency
 */

/**
 * @typedef {"commander"|"radar"|"strategist"|"inkwriter"|"visualizer"|"dispatcher"|"echoer"|"catcher"|"abacus"|"followup"|"feedback"} RoleId
 */

/**
 * @typedef {"reconnaissance"|"content"|"interaction"|"conversion"|"recovery"|"review"} LineupId
 */

/**
 * @typedef {Object} DecisionContext
 * @property {string} missionId
 * @property {MissionType} missionType
 * @property {RiskLevel} riskLevel
 * @property {LatencyPriority} latencyPriority
 * @property {RevenueImpact} revenueImpact
 * @property {EvidenceSufficiency} evidenceSufficiency
 * @property {boolean} [requiresExternalAction]
 * @property {boolean} [requiresHumanTouchpoint]
 * @property {boolean} [hasWarmLead]
 * @property {boolean} [externalDependencyUnstable]
 * @property {number} [recentFailureCount]
 * @property {number} [budgetCap]
 * @property {string[]} [tags]
 */

/**
 * @typedef {Object} BudgetPlan
 * @property {number} tokenBudget
 * @property {number} toolBudget
 * @property {number} latencyBudgetSec
 * @property {number} parallelismBudget
 */

/**
 * @typedef {Object} StagePlan
 * @property {string} stageId
 * @property {string} label
 * @property {RoleId} ownerRole
 * @property {LineupId} lineupId
 * @property {boolean} parallelAllowed
 */

/**
 * @typedef {Object} ApprovalGate
 * @property {string} action
 * @property {RiskLevel} riskLevel
 * @property {boolean} required
 * @property {string} reason
 */

/**
 * @typedef {Object} StopLossRule
 * @property {number} maxRetry
 * @property {number} maxBudgetOverrunRatio
 * @property {boolean} killOnRepeatedFailure
 * @property {boolean} freezeOnApprovalReject
 */

/**
 * @typedef {Object} CommanderDecision
 * @property {string} decisionVersion
 * @property {string} missionId
 * @property {MissionType} missionType
 * @property {LineupId[]} selectedLineups
 * @property {RoleId[]} activeRoles
 * @property {StagePlan[]} stagePlan
 * @property {BudgetPlan} budgetPlan
 * @property {ApprovalGate[]} approvalPlan
 * @property {StopLossRule} stopLossRule
 * @property {string[]} arbitrationPriority
 * @property {boolean} requiresCommanderSupervision
 * @property {boolean} requiresHumanReview
 * @property {string[]} reasons
 * @property {string[]} appliedRuleIds
 * @property {string[]} matchedRuleIds
 */

export {};
