import { getVpicClient, type VehicleMatch } from '#/server/vehiclefit/vpic'
import type { AgentTool } from '../tool'

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

/** identify_vehicle: verify a make/model against NHTSA's free vPIC API. */
export const identifyVehicleTool: AgentTool = {
  name: 'identify_vehicle',
  description: `Verify a vehicle make and model against NHTSA's free vPIC database. Use this before researching cargo dimensions when the vehicle name is uncertain. This confirms the make/model family only; it does not supply cargo measurements.`,
  parameters: {
    type: 'object',
    properties: {
      make: { type: 'string', description: 'Vehicle manufacturer, e.g. Honda.' },
      model: { type: 'string', description: 'Vehicle model, e.g. CR-V.' },
      year: {
        type: 'integer',
        description: 'Model year when known. Optional; retain it for later spec research.',
      },
    },
    required: ['make', 'model'],
  },
  statusLabel(args) {
    const make = nonEmptyString(args.make)
    const model = nonEmptyString(args.model)
    return make && model ? `Identifying ${make} ${model}` : 'Identifying vehicle'
  },
  async execute(args) {
    const make = nonEmptyString(args.make)
    const model = nonEmptyString(args.model)
    const year =
      typeof args.year === 'number' && Number.isSafeInteger(args.year)
        ? args.year
        : undefined
    if (!make || !model) return 'Error: make and model are required.'

    let result: VehicleMatch
    try {
      result = await getVpicClient().identifyVehicle({ make, model, year })
    } catch {
      return 'Could not verify the vehicle because vehicle lookup is temporarily unavailable.'
    }
    const label = `${year ? `${year} ` : ''}${result.make} ${result.model}`
    if (result.error) {
      return `Could not verify ${label}: ${result.error}`
    }
    if (result.matched) {
      return `Vehicle identified: ${label}. Continue by finding cargo dimensions from reliable vehicle-spec sources.`
    }
    if (result.candidates.length > 0) {
      return `Could not verify ${label}. Similar vPIC models: ${result.candidates.join(', ')}. Ask the user to confirm before researching cargo dimensions.`
    }
    return `Could not verify ${label} in vPIC. Ask the user to confirm the make and model before researching cargo dimensions.`
  },
}
