/*
 * Lines that read true under any internship or new-grad posting, for the remixed threads in
 * seed-comments.mjs. Hand-written, so they cost nothing; kept field-neutral (no tech, finance,
 * hardware or city words), and free of claims about any employer.
 */

export const UNIVERSAL_C = [
  'applying before i talk myself out of it',
  'adding this to the spreadsheet of doom',
  'me with 0 experience reading "1+ years preferred" 💀',
  'the way i just hit apply without reading the whole thing',
  'my resume is held together by one group project and vibes',
  'applied. now we pray',
  'ok this one actually looks doable??',
  'lowkey this sounds fun ngl',
  'if i get this i owe my career center a fruit basket',
  'whoever gets this, put in a word for the rest of us',
  'this is application #87 for me this month and i am fine 🙂',
  'not me tailoring my resume for the 12th time today',
  'saved it, will apply at 2am like a normal person',
  'the cover letter is optional right?? RIGHT??',
  'manifesting a callback for everyone in this comment section',
  'bro i just want one (1) interview',
  'my mom is gonna ask about this at dinner i can feel it',
  'the "nice to have" section is my entire personality goals',
  'applying with the confidence of someone who has never been rejected',
  'imagine getting this as your first job. couldn\'t be me (yet)',
  'okay this is going straight to the top of my list',
  'they really said "entry level" and then listed everything 😭',
  'i read the qualifications and immediately felt humbled',
  'me pretending i\'m not refreshing my email every 5 minutes',
  'lowkey this would look so good on a resume',
  'another day another application',
  'this is the one. i can feel it. (i say this every time)',
  'praying the ats doesn\'t eat my resume',
  'my linkedin headline is about to change i can feel it',
  'the way i just updated my resume for this one specifically',
  'if this works out i\'m buying everyone here a coffee',
  'applying so fast my wifi can\'t keep up',
  'me after applying: time to forget about it for 6 weeks',
  'not the job description making me want to actually learn things',
  'this would be such a W ngl',
  'ok who else is applying, we can be anxious together',
  'my career fair handshake was not strong enough for this',
  'every application is a lottery ticket and i\'m buying them all',
  'my gpa looking at this posting like 👀',
  'applied, closed the tab, pretending it never happened',
  'it\'s giving dream internship energy',
  'this one feels different (copium)',
  'i would do this job so well if they just gave me a chance',
  'lowkey nervous to even click apply',
  'this sounds like the kind of job you tell your grandkids about',
  'adding "fast learner" to my resume rn',
  'the bar is high and i am short',
  'rejection emails have made me emotionally bulletproof. applying',
  'the dream is to get rejected by a human and not an algorithm',
  'currently on application #3 of the night. hydrate',
  'my resume is one page and 40% whitespace but we ball',
  'imagine having this on your linkedin 😮‍💨',
  'one day i\'ll be the one posting "excited to announce"',
  'sending this to my group chat immediately',
  'this is my sign to finally finish my resume',
  'me pressing apply with my eyes closed',
  'i\'d be so locked in at this job fr',
  'okay but the responsibilities actually sound interesting',
  'i\'m just here to read the comments before applying',
  'applying because my roommate dared me',
];

export const UNIVERSAL_Q = [
  'anyone know when they usually start reviewing applications?',
  'is a cover letter actually required or optional?',
  'do they accept students graduating next year?',
  'does anyone know if this is a rolling deadline?',
  'is this open to sophomores or juniors only?',
  'how long does it usually take to hear back from postings like this?',
  'do they sponsor visas or is it citizens only?',
  'is there a technical interview or just behavioral?',
  'is gpa a hard cutoff for this or nah',
  'can you apply to multiple roles at the same company?',
  'does this count for co-op credit at most schools?',
  'do they hire international students for this?',
  'is it ok to apply if i only meet like half the requirements?',
  'anyone know if there\'s a referral program for this?',
  'is this a summer role or does it go into the fall too?',
  'do they provide housing or a stipend for relocation?',
  'is there usually a return offer for roles like this?',
  'how many rounds of interviews do you think this has?',
  'do i put my projects or my coursework first for this one?',
  'should i apply now or wait until my resume is better',
  'does anyone know if they look at portfolios for this?',
  'is it weird to message a recruiter after applying?',
  'how many people do you think apply to these 😭',
  'anyone already apply? did you get an auto-email at least?',
  'is the start date flexible if school ends late?',
  'can grad students apply or is it undergrad only?',
  'is a 3.2 gpa enough to even try?',
  'do they care about clubs and stuff or just experience?',
  'does it matter if i apply on the last day?',
  'what\'s the best way to stand out for something like this?',
  'should i follow up if i don\'t hear back in a few weeks?',
  'is it part-time during the school year or full-time only?',
  'do they do group interviews for this kind of role?',
  'would a bootcamp project count as experience here?',
  'anyone know what the timeline looks like after applying?',
  'does applying early actually help?',
  'is there an online assessment for this one?',
  'can freshmen apply or is that delusional',
  'is this the kind of role where you get a mentor?',
  'is the team big or is it like 3 people?',
];

// Captions for GIFs that fit any posting; the GIF's own mood carries the joke.
export const UNIVERSAL_CAPTION = [
  'me after applying', 'me reading the requirements', 'waiting for a response like', 'my resume rn',
  'when the recruiter actually emails back', 'applying anyway', 'me at the interview', 'my bank account seeing this',
  'me refreshing my inbox', 'pressing submit', 'how i\'ll look if i get it', '',
];

/*
 * Everyday words a reused line may contain besides the words of the lines above. A line from
 * the Haiku threads is reused only if every word in it is in this set — an allow-list, because
 * the deny-lists missed "defense", "semiconductors" and "phd".
 */
export const EVERYDAY = new Set(`
a about actually after again all also always am an and any anyone anything apply applying applied are as at
back be because been before being best better bro but by can cant could day days did do does doing done dont
even ever every everyone fr for from get gets getting go goes going gonna got had has have having help here how
i if im in into is it its just know kind lets like literally lol lowkey make me mean more most much my need
never ngl no not now of off ok okay on one only or other our out over people please pretty probably real really
right rn same see should so some something sound sounds still such sure take than that the their them then there
these they thing things think this those though tho time to too u ur us very vibe vibes wait want was way we
well were what when where which who why will with work working would yeah yes you your
interview interviews interviewer resume resumes cover letter role roles job jobs posting team teams
intern interns internship internships grad grads student students school semester summer fall spring
experience learn learning skills apply applications application recruiter recruiters offer offers return
full part time hours week weeks month months year years first entry level new junior senior early late
requirements required qualifications preferred deadline rolling start date flexible mentor mentorship
honestly lowkey highkey deadass bestie besties chat cooked crying dead fine scared nervous excited hype
`.trim().split(/\s+/));
