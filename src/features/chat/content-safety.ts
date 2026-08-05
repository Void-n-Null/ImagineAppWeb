import type {
  ChatMessage,
  ImageAttachment,
  ProductAttachment,
  TurnRequestBody,
} from '#/features/agent'

export type SensitiveContentKind =
  | 'personal-information'
  | 'credential'
  | 'company-confidential'
  | 'image'

export interface SensitiveContentFinding {
  kind: SensitiveContentKind
  label: string
}

interface Rule {
  kind: SensitiveContentKind
  label: string
  pattern: RegExp
}

const TEXT_RULES: Rule[] = [
  {
    kind: 'personal-information',
    label: 'an email address',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  },
  {
    kind: 'personal-information',
    label: 'a phone number',
    pattern:
      /\+\d{1,3}(?:[\s().-]*\d){6,12}\b|(?:\+?1[\s.-]?)?(?:\(\d{3}\)[\s.-]?|\d{3}[\s.-])\d{3}[\s.-]\d{4}\b|\b(?:phone|mobile|cell|call(?: me| them)? at)\s*(?:is|:|=)?\s*[2-9]\d{2}[2-9]\d{6}\b/i,
  },
  {
    kind: 'personal-information',
    label: 'a Social Security number',
    pattern:
      /\b(?:\d{3}[- ]\d{2}[- ]\d{4}|(?:ssn|social security(?: number)?)\s*(?:is|:|#)?\s*\d{9})\b/i,
  },
  {
    kind: 'personal-information',
    label: 'a date of birth',
    pattern:
      /\b(?:(?:date of birth|dob|birthday)\s*(?:is|:)?\s*|born\s+on\s+)(?:\d{1,2}[/-]){2}\d{2,4}\b/i,
  },
  {
    kind: 'personal-information',
    label: 'a street address',
    pattern:
      /\b\d{1,6}\s+(?:[A-Z0-9.'-]+\s+){1,5}(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way|parkway|pkwy)\b/i,
  },
  {
    kind: 'personal-information',
    label: 'a customer or employee name',
    pattern: /\b(?:customer|employee|client|member)\s+name\s*(?:is|:|=)\s*\S+/i,
  },
  {
    kind: 'personal-information',
    label: 'a customer, employee, order, or account identifier',
    pattern:
      /\b(?:employee|customer|client|member|party|account|order)\s*(?:id|number|#)\s*(?::|=|#|-)?\s*[A-Z0-9-]{4,}\b/i,
  },
  {
    kind: 'credential',
    label: 'a bearer token, JWT, private key, or prefixed API credential',
    pattern:
      /\bBearer\s+[A-Z0-9._~+/-]{12,}=*\b|\beyJ[A-Z0-9_-]{10,}\.[A-Z0-9_-]{10,}\.[A-Z0-9_-]{10,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[A-Z0-9_-]{16,}|gh[POSUR]_[A-Z0-9]{16,}|xox[BAPRS]-[A-Z0-9-]{16,}|AIza[A-Z0-9_-]{20,})\b/i,
  },
  {
    kind: 'company-confidential',
    label: 'a confidentiality marking',
    pattern:
      /\b(?:confidential\s*(?::|=|-)|confidential\s+(?:document|file|data|information|memo|report)|marked\s+confidential|internal[- ]only|employee[- ]only|proprietary\s+(?:document|file|data|information)|not for distribution|do not share)\b/i,
  },
  {
    kind: 'company-confidential',
    label: 'nonpublic plans, forecasts, lists, or internal materials',
    pattern:
      /\b(?:(?:internal|nonpublic|confidential|store|district|company)\s+(?:business plans?|marketing strateg(?:y|ies)|sales forecasts?|revenue forecasts?|financial forecasts?)|holiday results?|customer lists?|employee rosters?|internal memos?|advance ads?|drive time playbooks?|inventory allocations?|retail insider)\b/i,
  },
  {
    kind: 'company-confidential',
    label: 'nonpublic operational or financial information',
    pattern:
      /\b(?:store|district|market|company)(?:\s+\d+)?\s+(?:sales|revenue|margin|labor|headcount|forecasts?|budgets?|results?)\s*(?:(?:is|was)\s+(?:up|down|increased|decreased|\$?\d[\d,]*(?:\.\d+)?%?)|(?::|=)\s*\$?\d[\d,]*(?:\.\d+)?%?|\$?\d[\d,]*(?:\.\d+)?%?|rose|fell|increased|decreased)\b/i,
  },
  {
    kind: 'company-confidential',
    label: 'unreleased company information',
    pattern:
      /\b(?:unreleased|unannounced|embargoed)\s+(?:product|promotion|ad|pricing|strategy|initiative|feature)\b/i,
  },
]

function passesLuhn(value: string): boolean {
  let sum = 0
  let double = false
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index])
    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    double = !double
  }
  return sum % 10 === 0
}

function containsPaymentCard(text: string): boolean {
  const candidates = text.match(/\b(?:\d[ -]?){13,19}\b/g) ?? []
  return candidates.some((candidate) => {
    const digits = candidate.replace(/\D/g, '')
    return digits.length >= 13 && digits.length <= 19 && passesLuhn(digits)
  })
}

function dedupeFindings(
  findings: SensitiveContentFinding[],
): SensitiveContentFinding[] {
  return findings.filter(
    (finding, index, all) =>
      all.findIndex((candidate) => candidate.label === finding.label) === index,
  )
}

const CREDENTIAL_LABEL = 'a password, PIN, token, secret, or API key'

/**
 * Words that follow a credential noun in ordinary product/support language.
 * "A password is required" is a sentence; "password: hunter2" is a secret.
 */
const CREDENTIAL_STOPWORDS = new Set([
  'required',
  'needed',
  'optional',
  'mandatory',
  'reset',
  'resets',
  'manager',
  'managers',
  'policy',
  'policies',
  'requirement',
  'requirements',
  'help',
  'change',
  'changed',
  'forgot',
  'forgotten',
  'strength',
  'protected',
  'protection',
  'field',
  'fields',
  'prompt',
  'prompts',
  'question',
  'questions',
  'rule',
  'rules',
  'guideline',
  'guidelines',
  'security',
  'safety',
  'tips',
  'generator',
  'reader',
  'readers',
  'entry',
  'code',
  'codes',
  'lock',
  'locked',
  'recovery',
  'hint',
  'support',
  'setup',
  'enabled',
  'disabled',
  'wrong',
  'incorrect',
  'invalid',
  'correct',
  'should',
  'must',
  'can',
  'will',
  'would',
  'never',
  'always',
  'here',
  'there',
  'this',
  'that',
  'used',
  'using',
])

/** A captured value that looks like an actual secret rather than prose. */
function looksLikeSecret(raw: string): boolean {
  const value = raw.replace(/^["'`{[(]+/, '').replace(/["'`}\])[.,;:!?]+$/g, '')
  if (value.length < 4) return false
  if (CREDENTIAL_STOPWORDS.has(value.toLowerCase())) return false
  // Digits/symbols mark a secret; long unbroken letter runs do too.
  return /[\d\W_]/.test(value) || value.length >= 8
}

/**
 * Credential assignments, checked by VALUE rather than by keyword alone, so
 * "PIN reader" and "a password is required" stay askable while
 * `password: hunter2` and `{"password":"hunter2"}` are blocked.
 */
function inspectCredentials(text: string): SensitiveContentFinding[] {
  const assignment =
    /\b(?:password|passcode|pin|api[- ]?key|access[- ]?token|auth[- ]?token|secret)\b\s*(?:is|:|=)?\s*(\S+)/gi
  for (const match of text.matchAll(assignment)) {
    if (looksLikeSecret(match[1] ?? '')) {
      return [{ kind: 'credential', label: CREDENTIAL_LABEL }]
    }
  }
  return []
}

export function inspectSensitiveText(text: string): SensitiveContentFinding[] {
  // Unwrap JSON/YAML-quoted keys so a forged `{"password":"hunter2"}` reads
  // the same as `password: hunter2` to the rules below.
  const normalized = text.replace(
    /(["'])(password|passcode|pin|api[- ]?key|access[- ]?token|auth[- ]?token|secret)\1\s*:/gi,
    '$2:',
  )
  const findings = TEXT_RULES.filter((rule) =>
    rule.pattern.test(normalized),
  ).map(({ kind, label }) => ({ kind, label }))

  findings.push(...inspectCredentials(normalized))

  if (containsPaymentCard(text)) {
    findings.push({
      kind: 'personal-information',
      label: 'a payment card number',
    })
  }

  return dedupeFindings(findings)
}

/** Collect every string in opaque model-bound JSON, including property names. */
function collectNestedStrings(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    output.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNestedStrings(item, output)
    return
  }
  if (typeof value !== 'object' || value === null) return
  for (const [key, item] of Object.entries(value)) {
    output.push(key)
    if (typeof item === 'string') output.push(`${key}: ${item}`)
    collectNestedStrings(item, output)
  }
}

function inspectStrings(strings: readonly string[]): SensitiveContentFinding[] {
  return strings.flatMap(inspectSensitiveText)
}

export function inspectOutboundMessage(
  text: string,
  attachments?: {
    products?: ProductAttachment[]
    images?: ImageAttachment[]
  },
): SensitiveContentFinding[] {
  const findings = inspectSensitiveText(text)
  const productStrings = (attachments?.products ?? []).flatMap((product) => [
    product.name,
    product.context,
  ])
  findings.push(...inspectStrings(productStrings))
  if ((attachments?.images?.length ?? 0) > 0) {
    findings.push({
      kind: 'image',
      label: 'an image that cannot be reliably screened',
    })
  }
  return dedupeFindings(findings)
}

export function inspectOutboundTranscript(
  transcript: ChatMessage[],
): SensitiveContentFinding[] {
  const findings = transcript.flatMap((message) => {
    if (message.role === 'user') {
      return inspectOutboundMessage(message.content, {
        products: message.attachedProducts,
        images: message.attachedImages,
      })
    }

    if (message.role === 'assistant') {
      const strings = [message.content]
      for (const toolCall of message.toolCalls ?? []) {
        strings.push(toolCall.id, toolCall.name, toolCall.argumentsJson)
        collectNestedStrings(toolCall.arguments, strings)
      }
      for (const detail of message.reasoningDetails ?? []) {
        collectNestedStrings(detail, strings)
      }
      return inspectStrings(strings)
    }

    return inspectStrings([
      message.toolCallId,
      message.toolName,
      message.content,
    ])
  })
  return dedupeFindings(findings)
}

export function inspectUntrustedTurnRequest(
  body: TurnRequestBody,
): SensitiveContentFinding[] {
  const cartStrings = body.cart.flatMap((item) => [
    item.name,
    item.manufacturer,
    item.modelNumber,
    item.upc,
  ])
  return dedupeFindings([
    ...inspectOutboundTranscript(body.messages),
    ...inspectStrings(
      cartStrings.filter((value): value is string => value !== null),
    ),
    ...inspectStrings([body.clock.iso, body.clock.timeZone]),
  ])
}

export function sensitiveContentBlockMessage(
  findings: SensitiveContentFinding[],
): string {
  const labels = findings.map((finding) => finding.label)
  const detail =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(', ')}, or ${labels.at(-1)}`
  return `Remove ${detail}, then try again.`
}

export const SENSITIVE_CONTEXT_BLOCK_MESSAGE =
  'This chat contains earlier or attached content that cannot be safely sent again. Remove it or start a new chat.'
