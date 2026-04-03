export interface BrainShadowRunnerInput {
  dispatchId: string;
  payloadPreview: Record<string, unknown>;
}

export interface BrainShadowRunnerResult {
  status: 'simulated';
  note: string;
}

export async function simulateBrainShadowDispatch(
  input: BrainShadowRunnerInput,
): Promise<BrainShadowRunnerResult> {
  return {
    status: 'simulated',
    note: `Brain shadow dispatch prepared for ${input.dispatchId}`,
  };
}
