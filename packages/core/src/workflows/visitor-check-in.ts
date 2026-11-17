import type { WorkflowDefinition } from '@chaostwin/contracts';
import { DEMO_LAUNCH_ACTIVITY, DEMO_PACKAGE_NAME, WorkflowDefinitionSchema, parseWithSchema } from '@chaostwin/contracts';

/**
 * Sample visitor check-in for the ChaosTwin demo app.
 * Submit is a UI tap. The record check is a local GET and does not create another visit.
 */
export function visitorCheckInWorkflow(): WorkflowDefinition {
  return parseWithSchema(
    WorkflowDefinitionSchema,
    {
      id: 'visitor-check-in',
      name: 'Visitor check-in',
      stopOnFailure: true,
      steps: [
        {
          id: 'launch',
          type: 'launch-app',
          packageName: DEMO_PACKAGE_NAME,
          activity: DEMO_LAUNCH_ACTIVITY,
          timeoutMs: 15_000,
        },
        {
          id: 'visitor_name',
          type: 'enter-text',
          selector: 'id:visitor_name',
          text: 'Test Visitor',
          timeoutMs: 10_000,
        },
        {
          id: 'start_visit',
          type: 'tap',
          selector: 'id:start_visit',
          timeoutMs: 10_000,
        },
        {
          id: 'submit_visit',
          type: 'tap',
          selector: 'id:submit_visit',
          timeoutMs: 10_000,
        },
        {
          id: 'visit_status',
          type: 'assert-text',
          selector: 'id:visit_status',
          text: 'Checked in',
          timeoutMs: 10_000,
        },
        {
          id: 'records',
          type: 'api-verify',
          method: 'GET',
          url: 'http://127.0.0.1:8080/visitors',
          expectStatus: 200,
          timeoutMs: 10_000,
        },
        {
          id: 'evidence_shot',
          type: 'screenshot',
          timeoutMs: 10_000,
        },
      ],
    },
    'Visitor check-in workflow',
  );
}
