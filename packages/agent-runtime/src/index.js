export const packageName = '@aillive/agent-runtime'
export const packageRole = 'Agent state machine, planning, context assembly, tool routing, verification, and checkpoints.'

export function describePackage() {
  return {
    name: packageName,
    role: packageRole,
    status: 'skeleton',
  }
}

export const agentStates = [
  'created',
  'loaded_context',
  'planned',
  'executing',
  'waiting_for_permission',
  'verifying',
  'checkpointed',
  'completed',
  'failed',
  'interrupted',
]

export function getRuntimeStatus(options = {}) {
  const subsystems = options.subsystems || []
  const unavailable = subsystems.filter((item) => ['disabled', 'unavailable', 'not-a-repository'].includes(item.status))
  return {
    component: 'runtime',
    package: packageName,
    status: 'skeleton',
    stateMachine: agentStates,
    subsystems,
    readyForAgentRun: unavailable.length === 0,
    unavailable: unavailable.map((item) => item.component),
  }
}
