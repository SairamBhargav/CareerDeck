/**
 * Job families — docs/PHASE8.md §2.
 *
 * The field a posting belongs to, so the deck can show a CS student software and data roles
 * rather than whatever happened to be posted most recently. Eight families, deliberately
 * coarse: they have to line up with what a student studied, and "Model Inference" or "Corporate
 * Spend" (what companies call themselves) cannot.
 *
 * Title first, because the title is the employer's own one-line statement of the role. Skills
 * only break a tie when the title says nothing ("Technology Intern", "Associate").
 */

export type JobFamily =
  | 'software'
  | 'data_ml'
  | 'hardware'
  | 'product'
  | 'design'
  | 'business'
  | 'sales_marketing'
  | 'operations';

export const JOB_FAMILIES: JobFamily[] = [
  'software', 'data_ml', 'hardware', 'product', 'design', 'business', 'sales_marketing', 'operations',
];

/**
 * Ordered most specific first; the first match wins. The order carries the decisions:
 *
 *  - design before product, so "Product Designer" is design
 *  - product before software, so "Technical Program Manager" and "Product Manager, Platform"
 *    are product rather than software ("platform" would otherwise claim them)
 *  - data_ml before software, so "Data Engineer" and "Machine Learning Engineer" are data_ml
 *  - hardware before software, so "Firmware Engineer" and "Embedded Software Engineer" are
 *    hardware — the students those roles want studied EE/CE
 *  - sales_marketing before business, so "Business Development" is sales, not business
 */
const TITLE_RULES: [JobFamily, RegExp][] = [
  // Before data_ml, which would otherwise claim it on the word "data".
  ['hardware', /\bdata ?cent(er|re)\b/i],
  // Chip and circuit design is hardware, before `design` reads "Designer": "FPGA Designer",
  // "Digital IC Design Intern" and "Analog Design Intern" want EE students, not UX ones.
  ['hardware', /\b(fpga|asic|analog|ic|rfic|integrated circuit|pcb|silicon|chip|logic(al)?|physical design|circuit|packaging|verification engineer|turbomachinery|optic(s|al)|photonics|controls? (engineer\w*|system\w*)|mechatronics|materials|power electronics)\b/i],
  ['design', /\b(designer|design (intern|lead|manager)|ux|ui\/ux|user experience|user interface|graphic|visual design|brand design|motion design|illustrator)\b/i],
  ['product', /\b(product manag\w*|product owner|product lead|program manag\w*|project manag\w*|tpm|apm|product management|product operations|product intern)\b/i],
  ['data_ml', /\b(data|machine learning|ml|ai|artificial intelligence|deep learning|analytics|scientist|research (engineer|scientist)|quant\w*|statistic\w*|nlp|computer vision|llm|applied scientist)\b/i],
  ['hardware', /\b(hardware|electrical|mechanical|manufacturing|firmware|embedded|asic|fpga|rf|robotics|avionics|propulsion|test engineer|test technician|technician|production (associate|planner|engineer)|quality (inspector|engineer)|systems integration|packaging|thermal|structural|aerospace|silicon|chip|gnc|controls engineer|electronics|wire harness|machinist|assembler|welder)\b/i],
  ['sales_marketing', /\b(sales|account executive|account (development|manager)|ae|sdr|bdr|business development|partnerships?|marketing|growth|brand|communications|comms|content|social media|public relations|pr|customer success|solutions (consultant|engineer)|sales engineer|go[- ]to[- ]market|gtm|demand gen\w*|events?)\b/i],
  // No bare "engineering intern": "Methods Engineering Intern" is manufacturing, and a title
  // that only says "engineering" is left unclassified rather than guessed.
  ['software', /\b(software|swe|developer|computer science|full[- ]?stack|front[- ]?end|back[- ]?end|mobile|ios|android|web|platform|infrastructure|devops|sre|site reliability|cloud|security|cyber\w*|it|systems administrator|network engineer|forward deployed|solutions architect|technical support engineer|qa|test automation)\b/i],
  ['business', /\b(financ\w*|accounting|accountant|analyst|strategy|strategic|business operations|biz ?ops|consult\w*|investment|treasury|tax|audit\w*|fp&a|controller|revenue|pricing|economist|actuar\w*|risk|compliance|aml|payroll)\b/i],
  ['operations', /\b(operations|ops|supply chain|logistics|procurement|buyer|sourcing|planner|support|customer (service|experience)|recruit\w*|talent|people|human resources|hr|legal|counsel|paralegal|policy|office|executive assistant|workplace|facilities|trust (and|&) safety|community)\b/i],
];

/** Skill hints for titles that name no field. Counted, and the family with the most hits wins. */
const SKILL_FAMILIES: Record<string, JobFamily> = {
  python: 'software', java: 'software', javascript: 'software', typescript: 'software', react: 'software',
  go: 'software', rust: 'software', 'c++': 'software', kubernetes: 'software', aws: 'software',
  sql: 'data_ml', pandas: 'data_ml', pytorch: 'data_ml', tensorflow: 'data_ml', 'machine learning': 'data_ml',
  statistics: 'data_ml', tableau: 'data_ml', excel: 'business', 'financial modeling': 'business',
  salesforce: 'sales_marketing', hubspot: 'sales_marketing', seo: 'sales_marketing',
  figma: 'design', solidworks: 'hardware', cad: 'hardware', matlab: 'hardware', verilog: 'hardware',
  'embedded c': 'hardware', pcb: 'hardware',
};

/**
 * The role, before the team or product it sits on: "Account Executive" in "Account Executive,
 * AI Platform". Without this the rule order decides, and "AI" would make an AE a data role.
 */
function roleHead(title: string): string {
  return title.split(/,|\s[-–—|]\s|\(|:/)[0] ?? title;
}

export function classifyFamily(title: string, skills: string[] = []): JobFamily | null {
  for (const text of [roleHead(title), title]) {
    for (const [family, pattern] of TITLE_RULES) {
      if (pattern.test(text)) return family;
    }
  }

  const votes = new Map<JobFamily, number>();
  for (const skill of skills) {
    const family = SKILL_FAMILIES[skill.toLowerCase()];
    if (family) votes.set(family, (votes.get(family) ?? 0) + 1);
  }
  let best: JobFamily | null = null;
  let bestVotes = 0;
  for (const [family, count] of votes) {
    if (count > bestVotes) {
      best = family;
      bestVotes = count;
    }
  }
  // One stray skill is not a field: "Excel" appears in every job ad ever written.
  return bestVotes >= 2 ? best : null;
}
