import type { ExperimentStatus, FaultResult, RecoveryAssertion } from '@chaostwin/contracts';

export function resolveExperimentStatus(input: {
  precondition: string | null;
  workflowFailed: boolean;
  fault: Pick<FaultResult, 'status' | 'mode' | 'restored'> | null;
  assertions: readonly Pick<RecoveryAssertion, 'status' | 'evidenceRefs'>[];
  missingEvidence: number;
}): ExperimentStatus {
  if (input.precondition) {
    return 'ERROR';
  }
  if (input.workflowFailed) {
    return 'FAIL';
  }
  if (input.assertions.some((assertion) => assertion.status === 'FAILED')) {
    return 'FAIL';
  }
  const faultApplied = input.fault?.status === 'APPLIED' && input.fault.mode === 'actual';
  if (!faultApplied) {
    return 'INCONCLUSIVE';
  }
  if (!input.fault?.restored) {
    return 'FAIL';
  }
  if (
    input.assertions.length === 0 ||
    input.missingEvidence > 0 ||
    input.assertions.some((assertion) => assertion.status !== 'PASSED' || assertion.evidenceRefs.length === 0)
  ) {
    return 'INCONCLUSIVE';
  }
  return 'PASS';
}
