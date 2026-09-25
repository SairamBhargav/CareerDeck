/*
 * The vocabulary every pseudonym in the product is drawn from — phase 3, `handle_words`.
 *
 * A comment shows `quiet-otter-4821`, not a name the user chose, and PHASE3.md §2.1 argues
 * why: a self-chosen handle is a second identity to moderate, and it can carry a slur, a real
 * name, a school the account has never verified, or a homoglyph impersonation of somebody
 * else. A generated one carries nothing.
 *
 * Which puts a constraint on this file that is easy to miss and expensive to get wrong:
 * **every pair of these words has to be inoffensive**, because the generator will eventually
 * produce all of them and there is nobody to blame but this list. So the adjectives are calm
 * rather than evaluative (no `lucky`, no `clever` — a handle should not flatter or mock its
 * owner), and the nouns are concrete, mostly animals and weather and landscape, with nothing
 * anatomical, political, religious, or attached to a nationality.
 *
 * 96 × 96 × 9000 is ~83M combinations, so `generate_handle()` almost never has to retry.
 */

export const HANDLE_ADJECTIVES: string[] = [
  'amber', 'ancient', 'arctic', 'autumn', 'azure', 'balmy', 'bold', 'brave',
  'bright', 'brisk', 'bronze', 'calm', 'candid', 'cedar', 'citrus', 'civic',
  'coastal', 'cobalt', 'copper', 'coral', 'cosmic', 'crimson', 'crisp', 'dapper',
  'dawn', 'deft', 'distant', 'dusty', 'eager', 'early', 'eastern', 'electric',
  'emerald', 'even', 'fabled', 'fleet', 'floral', 'fluent', 'frosted', 'gentle',
  'gilded', 'glacial', 'golden', 'granite', 'hazel', 'hidden', 'hollow', 'humble',
  'indigo', 'inland', 'ivory', 'jade', 'keen', 'lantern', 'level', 'lilac',
  'linen', 'lunar', 'maple', 'marble', 'mellow', 'midnight', 'mild', 'misty',
  'modest', 'northern', 'olive', 'opal', 'orbit', 'patient', 'pewter', 'placid',
  'polar', 'prairie', 'quiet', 'rapid', 'rustic', 'saffron', 'sandy', 'scarlet',
  'silent', 'silver', 'slate', 'solar', 'southern', 'spruce', 'steady', 'sunlit',
  'tidal', 'timber', 'tranquil', 'velvet', 'verdant', 'western', 'willow', 'winter',
];

export const HANDLE_NOUNS: string[] = [
  'acorn', 'alder', 'anchor', 'aspen', 'atlas', 'badger', 'basin', 'beacon',
  'birch', 'bison', 'bluff', 'brook', 'canyon', 'cedar', 'cirrus', 'cobble',
  'comet', 'compass', 'coral', 'cove', 'crane', 'crest', 'cypress', 'delta',
  'dune', 'eagle', 'ember', 'falcon', 'fathom', 'fennel', 'fern', 'finch',
  'fjord', 'forge', 'gannet', 'geyser', 'glade', 'granite', 'grove', 'harbor',
  'heron', 'hollow', 'ibis', 'inlet', 'juniper', 'kestrel', 'lagoon', 'lantern',
  'ledger', 'lichen', 'lynx', 'magpie', 'marsh', 'meadow', 'mesa', 'monsoon',
  'moraine', 'narwhal', 'nimbus', 'oriole', 'osprey', 'otter', 'oxbow', 'pelican',
  'pinion', 'plover', 'quarry', 'quill', 'rapids', 'raven', 'reef', 'ridge',
  'rookery', 'sable', 'sandpiper', 'sequoia', 'shale', 'sierra', 'sparrow', 'spire',
  'sprout', 'starling', 'summit', 'swallow', 'sycamore', 'talon', 'tamarack', 'thicket',
  'thistle', 'tundra', 'vesper', 'walnut', 'warbler', 'willow', 'zenith', 'zephyr',
];
