# Artifact Relations

Allowed paths:

- MissionPlan -> SignalBrief
- MissionPlan -> StrategyRoute
- SignalBrief -> StrategyRoute
- StrategyRoute -> CopyPack
- CopyPack -> StoryboardPack
- MissionPlan + StrategyRoute + StoryboardPack -> ExecutionPlan
- Interaction/Conversation Data -> LeadAssessment
- LeadAssessment -> ValueScoreCard
- LeadAssessment + ValueScoreCard -> FollowUpActionPlan
