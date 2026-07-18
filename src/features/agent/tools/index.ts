import { ToolRegistry } from '../tool-registry'
import { analyzeProductTool } from './analyze-product-tool'
import {
  addToCartTool,
  clearCartTool,
  removeFromCartTool,
  viewCartTool,
} from './cart-tools'
import { compareProductsTool } from './compare-products-tool'
import { computeTvFitTool } from './compute-tv-fit-tool'
import { getTimeTool } from './get-time-tool'
import { identifyVehicleTool } from './identify-vehicle-tool'
import { requestScanTool } from './request-scan-tool'
import { searchProductsTool } from './search-products-tool'
import { storeAvailabilityTool } from './store-availability-tool'
import { webSearchTool } from './web-search-tool'

export { analyzeProductTool } from './analyze-product-tool'
export {
  addToCartTool,
  clearCartTool,
  removeFromCartTool,
  viewCartTool,
} from './cart-tools'
export { compareProductsTool } from './compare-products-tool'
export { computeTvFitTool } from './compute-tv-fit-tool'
export { formatAttachmentContext, formatProductContext } from './format'
export { getTimeTool } from './get-time-tool'
export { identifyVehicleTool } from './identify-vehicle-tool'
export { requestScanTool } from './request-scan-tool'
export { searchProductsTool } from './search-products-tool'
export { storeAvailabilityTool } from './store-availability-tool'
export { webSearchTool } from './web-search-tool'

/** The floor-assistant tool set (IMA-6). One registry per conversation send. */
export function buildDefaultToolRegistry(): ToolRegistry {
  return new ToolRegistry([
    searchProductsTool,
    analyzeProductTool,
    identifyVehicleTool,
    computeTvFitTool,
    compareProductsTool,
    webSearchTool,
    requestScanTool,
    storeAvailabilityTool,
    addToCartTool,
    removeFromCartTool,
    viewCartTool,
    clearCartTool,
    getTimeTool,
  ])
}
