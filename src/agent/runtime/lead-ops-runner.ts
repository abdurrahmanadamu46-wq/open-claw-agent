export interface LeadOpsRunnerInput {
  dispatchId: string;
  payloadPreview: Record<string, unknown>;
}

export interface LeadOpsRunnerResult {
  status: 'simulated';
  note: string;
}

export async function simulateLeadOpsDispatch(
  input: LeadOpsRunnerInput,
): Promise<LeadOpsRunnerResult> {
  return {
    status: 'simulated',
    note: `Lead ops dispatch prepared for ${input.dispatchId}`,
  };
}
