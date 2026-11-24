import type { ClientTool } from './claude';
import { companionJson } from './context';

const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object' as const,
  properties,
  required,
  additionalProperties: false,
});

/** Checks Claude's tool input (validated here: streamed tool input isn't checked by the API). */
function str(input: unknown, name: string): string {
  const v = (input as Record<string, unknown> | null)?.[name];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} 값이 필요해요`);
  return v.trim();
}

/** SmartThings tools for Claude; the calls go through G2 Context, which holds the SmartThings login. */
export function smartThingsTools(pairingCode: string): ClientTool[] {
  const call = async (path: string, body?: unknown) => JSON.stringify(await companionJson(path, pairingCode, body));
  return [
    {
      def: {
        name: 'smartthings_devices',
        description:
          "List the user's SmartThings devices (id, name, capabilities) and scenes. Call this first to find the id of the device or scene the user means.",
        input_schema: obj({}, []),
        eager_input_streaming: true,
      },
      run: () => call('/st/devices'),
    },
    {
      def: {
        name: 'smartthings_status',
        description: "Get one device's current state (on/off, temperature, level, mode...).",
        input_schema: obj({ device_id: { type: 'string' } }, ['device_id']),
        eager_input_streaming: true,
      },
      run: async (input) => call(`/st/status?id=${encodeURIComponent(str(input, 'device_id'))}`),
    },
    {
      def: {
        name: 'smartthings_command',
        description:
          'Send a command to a device. Use standard SmartThings capability/command names that appear in the device\'s capabilities, e.g. switch on/off, ' +
          'switchLevel setLevel [0-100], airConditionerMode setAirConditionerMode ["cool"], thermostatCoolingSetpoint setCoolingSetpoint [24], ' +
          'colorTemperature setColorTemperature [3000].',
        input_schema: obj(
          {
            device_id: { type: 'string' },
            capability: { type: 'string' },
            command: { type: 'string' },
            arguments: { type: 'array', items: {} },
          },
          ['device_id', 'capability', 'command'],
        ),
        eager_input_streaming: true,
      },
      run: async (input) => {
        const args = (input as { arguments?: unknown })?.arguments;
        if (args !== undefined && !Array.isArray(args)) throw new Error('arguments는 배열이어야 해요');
        return call('/st/command', {
          deviceId: str(input, 'device_id'),
          capability: str(input, 'capability'),
          command: str(input, 'command'),
          arguments: args ?? [],
        });
      },
    },
    {
      def: {
        name: 'smartthings_scene',
        description: 'Run a SmartThings scene.',
        input_schema: obj({ scene_id: { type: 'string' } }, ['scene_id']),
        eager_input_streaming: true,
      },
      run: async (input) => call('/st/command', { sceneId: str(input, 'scene_id') }),
    },
  ];
}
