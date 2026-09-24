/*
 * The curated skills dictionary — docs/README.md §4.4.
 *
 * "Dictionary-based extraction against a curated `skills` table, not free-form LLM output.
 * Free-form gives you `React`, `ReactJS`, `React.js`, and `react` as four skills and your
 * filters quietly stop working."
 *
 * `label` is the one spelling that reaches `jobs.skills`, the card and the filter. `slug`
 * is the stable key. `aliases` are every other way postings write it — and the aliases are
 * the whole value of the file: without them a posting saying "golang" and one saying "Go"
 * are two different skills.
 *
 * Seeded into `public.skills`, which is a table and not an enum precisely because this set
 * grows. Adding an entry is an insert plus a re-ingest, not a migration.
 *
 * Matching is token-based (see server/src/ingest/normalize/skills.ts), so aliases must be
 * written as they appear in prose, not as regexes. A one-token alias that is also an
 * ordinary English word ("go", "r", "rust") is safe here only because the tokenizer
 * requires a whole-token match — but anything shorter than two characters is still
 * omitted, because "R" matches every sentence that starts with it.
 */

export interface SkillSeed {
  slug: string;
  label: string;
  aliases: string[];
  category: 'language' | 'framework' | 'infra' | 'data' | 'practice' | 'domain';
}

export const SKILLS: SkillSeed[] = [
  // ── languages ────────────────────────────────────────────────────────────────
  { slug: 'python', label: 'Python', aliases: ['python3'], category: 'language' },
  { slug: 'javascript', label: 'JavaScript', aliases: ['js', 'ecmascript'], category: 'language' },
  { slug: 'typescript', label: 'TypeScript', aliases: ['ts'], category: 'language' },
  { slug: 'java', label: 'Java', aliases: [], category: 'language' },
  { slug: 'cpp', label: 'C++', aliases: ['c++', 'cpp', 'c plus plus'], category: 'language' },
  { slug: 'c', label: 'C', aliases: [], category: 'language' },
  { slug: 'csharp', label: 'C#', aliases: ['c#', 'csharp', 'c sharp'], category: 'language' },
  { slug: 'go', label: 'Go', aliases: ['golang'], category: 'language' },
  { slug: 'rust', label: 'Rust', aliases: [], category: 'language' },
  { slug: 'ruby', label: 'Ruby', aliases: [], category: 'language' },
  { slug: 'php', label: 'PHP', aliases: [], category: 'language' },
  { slug: 'swift', label: 'Swift', aliases: ['swiftui'], category: 'language' },
  { slug: 'kotlin', label: 'Kotlin', aliases: [], category: 'language' },
  { slug: 'objective-c', label: 'Objective-C', aliases: ['objective c', 'objc'], category: 'language' },
  { slug: 'scala', label: 'Scala', aliases: [], category: 'language' },
  { slug: 'elixir', label: 'Elixir', aliases: [], category: 'language' },
  { slug: 'haskell', label: 'Haskell', aliases: [], category: 'language' },
  { slug: 'ocaml', label: 'OCaml', aliases: ['ocaml'], category: 'language' },
  { slug: 'perl', label: 'Perl', aliases: [], category: 'language' },
  { slug: 'lua', label: 'Lua', aliases: [], category: 'language' },
  { slug: 'dart', label: 'Dart', aliases: [], category: 'language' },
  { slug: 'matlab', label: 'MATLAB', aliases: [], category: 'language' },
  { slug: 'verilog', label: 'Verilog', aliases: ['systemverilog'], category: 'language' },
  { slug: 'vhdl', label: 'VHDL', aliases: [], category: 'language' },
  { slug: 'assembly', label: 'Assembly', aliases: ['x86 assembly', 'arm assembly'], category: 'language' },
  { slug: 'shell', label: 'Shell Scripting', aliases: ['bash', 'zsh', 'shell scripting'], category: 'language' },
  { slug: 'sql', label: 'SQL', aliases: [], category: 'language' },
  { slug: 'r-lang', label: 'R', aliases: ['r programming', 'r language'], category: 'language' },
  { slug: 'solidity', label: 'Solidity', aliases: [], category: 'language' },
  { slug: 'julia', label: 'Julia', aliases: [], category: 'language' },

  // ── web and app frameworks ───────────────────────────────────────────────────
  { slug: 'react', label: 'React', aliases: ['reactjs', 'react.js'], category: 'framework' },
  { slug: 'react-native', label: 'React Native', aliases: ['reactnative'], category: 'framework' },
  { slug: 'nextjs', label: 'Next.js', aliases: ['next.js', 'nextjs'], category: 'framework' },
  { slug: 'vue', label: 'Vue', aliases: ['vuejs', 'vue.js'], category: 'framework' },
  { slug: 'angular', label: 'Angular', aliases: ['angularjs'], category: 'framework' },
  { slug: 'svelte', label: 'Svelte', aliases: ['sveltekit'], category: 'framework' },
  { slug: 'nodejs', label: 'Node.js', aliases: ['node.js', 'nodejs', 'node js'], category: 'framework' },
  { slug: 'express', label: 'Express', aliases: ['expressjs', 'express.js'], category: 'framework' },
  { slug: 'django', label: 'Django', aliases: [], category: 'framework' },
  { slug: 'flask', label: 'Flask', aliases: [], category: 'framework' },
  { slug: 'fastapi', label: 'FastAPI', aliases: [], category: 'framework' },
  { slug: 'rails', label: 'Ruby on Rails', aliases: ['ruby on rails', 'rails'], category: 'framework' },
  { slug: 'spring', label: 'Spring', aliases: ['spring boot', 'springboot'], category: 'framework' },
  { slug: 'dotnet', label: '.NET', aliases: ['.net', 'dotnet', 'asp.net'], category: 'framework' },
  { slug: 'laravel', label: 'Laravel', aliases: [], category: 'framework' },
  { slug: 'graphql', label: 'GraphQL', aliases: ['apollo graphql'], category: 'framework' },
  { slug: 'rest-api', label: 'REST APIs', aliases: ['rest api', 'restful', 'rest apis'], category: 'framework' },
  { slug: 'grpc', label: 'gRPC', aliases: [], category: 'framework' },
  { slug: 'flutter', label: 'Flutter', aliases: [], category: 'framework' },
  { slug: 'android', label: 'Android', aliases: ['android sdk', 'jetpack compose'], category: 'framework' },
  { slug: 'ios', label: 'iOS', aliases: ['uikit', 'ios sdk'], category: 'framework' },
  { slug: 'tailwind', label: 'Tailwind CSS', aliases: ['tailwind', 'tailwindcss'], category: 'framework' },
  { slug: 'html-css', label: 'HTML & CSS', aliases: ['html', 'css', 'html5', 'css3', 'scss', 'sass'], category: 'framework' },

  // ── infrastructure and platform ──────────────────────────────────────────────
  { slug: 'aws', label: 'AWS', aliases: ['amazon web services'], category: 'infra' },
  { slug: 'gcp', label: 'Google Cloud', aliases: ['gcp', 'google cloud platform'], category: 'infra' },
  { slug: 'azure', label: 'Azure', aliases: ['microsoft azure'], category: 'infra' },
  { slug: 'docker', label: 'Docker', aliases: ['containerization', 'containers'], category: 'infra' },
  { slug: 'kubernetes', label: 'Kubernetes', aliases: ['k8s', 'eks', 'gke'], category: 'infra' },
  { slug: 'terraform', label: 'Terraform', aliases: ['infrastructure as code', 'iac'], category: 'infra' },
  { slug: 'ansible', label: 'Ansible', aliases: [], category: 'infra' },
  { slug: 'linux', label: 'Linux', aliases: ['unix', 'ubuntu', 'debian'], category: 'infra' },
  { slug: 'ci-cd', label: 'CI/CD', aliases: ['ci/cd', 'continuous integration', 'continuous delivery', 'github actions', 'jenkins', 'circleci'], category: 'infra' },
  { slug: 'git', label: 'Git', aliases: ['github', 'gitlab', 'version control'], category: 'infra' },
  { slug: 'microservices', label: 'Microservices', aliases: ['microservice architecture'], category: 'infra' },
  { slug: 'serverless', label: 'Serverless', aliases: ['aws lambda', 'lambda functions', 'cloud functions'], category: 'infra' },
  { slug: 'kafka', label: 'Kafka', aliases: ['apache kafka'], category: 'infra' },
  { slug: 'rabbitmq', label: 'RabbitMQ', aliases: [], category: 'infra' },
  { slug: 'redis', label: 'Redis', aliases: [], category: 'infra' },
  { slug: 'nginx', label: 'Nginx', aliases: [], category: 'infra' },
  { slug: 'grafana', label: 'Grafana', aliases: ['prometheus'], category: 'infra' },
  { slug: 'datadog-tool', label: 'Datadog', aliases: [], category: 'infra' },
  { slug: 'observability', label: 'Observability', aliases: ['monitoring', 'tracing', 'opentelemetry'], category: 'infra' },
  { slug: 'distributed-systems', label: 'Distributed Systems', aliases: ['distributed computing'], category: 'infra' },
  { slug: 'system-design', label: 'System Design', aliases: ['systems design', 'architecture design'], category: 'infra' },
  { slug: 'networking', label: 'Networking', aliases: ['tcp/ip', 'tcp ip', 'http protocols'], category: 'infra' },
  { slug: 'embedded', label: 'Embedded Systems', aliases: ['firmware', 'rtos', 'microcontrollers'], category: 'infra' },

  // ── data and databases ───────────────────────────────────────────────────────
  { slug: 'postgresql', label: 'PostgreSQL', aliases: ['postgres'], category: 'data' },
  { slug: 'mysql', label: 'MySQL', aliases: ['mariadb'], category: 'data' },
  { slug: 'mongodb', label: 'MongoDB', aliases: ['mongo'], category: 'data' },
  { slug: 'dynamodb', label: 'DynamoDB', aliases: [], category: 'data' },
  { slug: 'cassandra', label: 'Cassandra', aliases: [], category: 'data' },
  { slug: 'elasticsearch', label: 'Elasticsearch', aliases: ['opensearch'], category: 'data' },
  { slug: 'snowflake-db', label: 'Snowflake', aliases: [], category: 'data' },
  { slug: 'bigquery', label: 'BigQuery', aliases: [], category: 'data' },
  { slug: 'redshift', label: 'Redshift', aliases: [], category: 'data' },
  { slug: 'databricks-tool', label: 'Databricks', aliases: [], category: 'data' },
  { slug: 'spark', label: 'Spark', aliases: ['apache spark', 'pyspark'], category: 'data' },
  { slug: 'hadoop', label: 'Hadoop', aliases: ['mapreduce'], category: 'data' },
  { slug: 'airflow', label: 'Airflow', aliases: ['apache airflow'], category: 'data' },
  { slug: 'dbt', label: 'dbt', aliases: [], category: 'data' },
  { slug: 'etl', label: 'ETL', aliases: ['elt', 'data pipelines', 'data pipeline'], category: 'data' },
  { slug: 'data-modeling', label: 'Data Modeling', aliases: ['dimensional modeling', 'data modelling'], category: 'data' },
  { slug: 'data-warehousing', label: 'Data Warehousing', aliases: ['data warehouse', 'lakehouse', 'data lake'], category: 'data' },
  { slug: 'tableau', label: 'Tableau', aliases: [], category: 'data' },
  { slug: 'looker', label: 'Looker', aliases: [], category: 'data' },
  { slug: 'power-bi', label: 'Power BI', aliases: ['powerbi'], category: 'data' },
  { slug: 'pandas', label: 'pandas', aliases: ['numpy'], category: 'data' },

  // ── machine learning ─────────────────────────────────────────────────────────
  { slug: 'machine-learning', label: 'Machine Learning', aliases: ['ml'], category: 'domain' },
  { slug: 'deep-learning', label: 'Deep Learning', aliases: ['neural networks'], category: 'domain' },
  { slug: 'pytorch', label: 'PyTorch', aliases: ['torch'], category: 'framework' },
  { slug: 'tensorflow', label: 'TensorFlow', aliases: ['keras'], category: 'framework' },
  { slug: 'jax', label: 'JAX', aliases: [], category: 'framework' },
  { slug: 'scikit-learn', label: 'scikit-learn', aliases: ['sklearn', 'scikit learn'], category: 'framework' },
  { slug: 'nlp', label: 'NLP', aliases: ['natural language processing'], category: 'domain' },
  { slug: 'computer-vision', label: 'Computer Vision', aliases: ['cv', 'image recognition', 'opencv'], category: 'domain' },
  { slug: 'llm', label: 'LLMs', aliases: ['large language models', 'llms', 'foundation models'], category: 'domain' },
  { slug: 'rag', label: 'RAG', aliases: ['retrieval augmented generation'], category: 'domain' },
  { slug: 'mlops', label: 'MLOps', aliases: ['ml ops', 'model deployment'], category: 'practice' },
  { slug: 'reinforcement-learning', label: 'Reinforcement Learning', aliases: ['rl'], category: 'domain' },
  { slug: 'recommendation-systems', label: 'Recommendation Systems', aliases: ['recsys', 'recommender systems', 'ranking systems'], category: 'domain' },
  { slug: 'cuda', label: 'CUDA', aliases: ['gpu programming'], category: 'framework' },
  { slug: 'statistics', label: 'Statistics', aliases: ['statistical analysis', 'statistical modeling'], category: 'domain' },
  { slug: 'ab-testing', label: 'A/B Testing', aliases: ['a/b testing', 'experimentation', 'ab testing'], category: 'practice' },

  // ── fundamentals and practice ────────────────────────────────────────────────
  { slug: 'algorithms', label: 'Algorithms', aliases: ['data structures', 'data structures and algorithms', 'dsa'], category: 'domain' },
  { slug: 'oop', label: 'Object-Oriented Design', aliases: ['object oriented design', 'object-oriented programming', 'oop'], category: 'practice' },
  { slug: 'testing', label: 'Testing', aliases: ['unit testing', 'integration testing', 'test automation', 'tdd', 'pytest', 'jest'], category: 'practice' },
  { slug: 'code-review', label: 'Code Review', aliases: ['peer review'], category: 'practice' },
  { slug: 'agile', label: 'Agile', aliases: ['scrum', 'kanban', 'sprint planning'], category: 'practice' },
  { slug: 'debugging', label: 'Debugging', aliases: ['troubleshooting', 'root cause analysis'], category: 'practice' },
  { slug: 'performance', label: 'Performance Optimization', aliases: ['performance tuning', 'profiling', 'latency optimization'], category: 'practice' },
  { slug: 'security', label: 'Security', aliases: ['application security', 'appsec', 'secure coding', 'threat modeling'], category: 'domain' },
  { slug: 'cryptography', label: 'Cryptography', aliases: ['encryption'], category: 'domain' },
  { slug: 'accessibility', label: 'Accessibility', aliases: ['a11y', 'wcag'], category: 'practice' },
  { slug: 'technical-writing', label: 'Technical Writing', aliases: ['documentation', 'design docs'], category: 'practice' },

  // ── product, design and business ─────────────────────────────────────────────
  { slug: 'product-management', label: 'Product Management', aliases: ['product strategy', 'roadmapping'], category: 'domain' },
  { slug: 'ux-design', label: 'UX Design', aliases: ['user experience', 'ux research', 'usability'], category: 'domain' },
  { slug: 'ui-design', label: 'UI Design', aliases: ['visual design', 'interaction design'], category: 'domain' },
  { slug: 'figma-tool', label: 'Figma', aliases: [], category: 'framework' },
  { slug: 'prototyping', label: 'Prototyping', aliases: ['wireframing'], category: 'practice' },
  { slug: 'design-systems', label: 'Design Systems', aliases: ['component libraries'], category: 'practice' },
  { slug: 'user-research', label: 'User Research', aliases: ['customer research', 'user interviews'], category: 'practice' },
  { slug: 'analytics', label: 'Analytics', aliases: ['product analytics', 'business analytics'], category: 'domain' },
  { slug: 'financial-modeling', label: 'Financial Modeling', aliases: ['valuation', 'dcf'], category: 'domain' },
  { slug: 'excel', label: 'Excel', aliases: ['spreadsheets', 'google sheets'], category: 'framework' },
  { slug: 'project-management', label: 'Project Management', aliases: ['program management', 'stakeholder management'], category: 'practice' },
  { slug: 'communication', label: 'Communication', aliases: ['written communication', 'verbal communication', 'cross functional collaboration'], category: 'practice' },

  // ── hardware, quant and specialist domains ───────────────────────────────────
  { slug: 'quantitative-research', label: 'Quantitative Research', aliases: ['quant research', 'quantitative analysis'], category: 'domain' },
  { slug: 'algorithmic-trading', label: 'Algorithmic Trading', aliases: ['market making', 'systematic trading'], category: 'domain' },
  { slug: 'low-latency', label: 'Low-Latency Systems', aliases: ['low latency', 'high frequency trading', 'hft'], category: 'domain' },
  { slug: 'robotics', label: 'Robotics', aliases: ['ros', 'motion planning'], category: 'domain' },
  { slug: 'controls', label: 'Control Systems', aliases: ['control theory', 'controls engineering'], category: 'domain' },
  { slug: 'signal-processing', label: 'Signal Processing', aliases: ['dsp', 'digital signal processing'], category: 'domain' },
  { slug: 'cad', label: 'CAD', aliases: ['solidworks', 'autocad', 'catia', 'nx'], category: 'framework' },
  { slug: 'fea', label: 'FEA', aliases: ['finite element analysis', 'ansys'], category: 'domain' },
  { slug: 'cfd', label: 'CFD', aliases: ['computational fluid dynamics'], category: 'domain' },
  { slug: 'pcb-design', label: 'PCB Design', aliases: ['altium', 'schematic capture'], category: 'domain' },
  { slug: 'fpga', label: 'FPGA', aliases: ['xilinx', 'altera'], category: 'domain' },
  { slug: 'semiconductors', label: 'Semiconductors', aliases: ['vlsi', 'asic design', 'chip design'], category: 'domain' },
  { slug: 'bioinformatics', label: 'Bioinformatics', aliases: ['computational biology', 'genomics'], category: 'domain' },
  { slug: 'blockchain', label: 'Blockchain', aliases: ['web3', 'smart contracts', 'ethereum'], category: 'domain' },
  { slug: 'game-development', label: 'Game Development', aliases: ['unreal engine', 'unity engine', 'game engines'], category: 'domain' },
  { slug: 'graphics', label: 'Graphics Programming', aliases: ['opengl', 'vulkan', 'shaders', 'rendering'], category: 'domain' },
  { slug: 'compilers', label: 'Compilers', aliases: ['llvm', 'compiler design'], category: 'domain' },
  { slug: 'operating-systems', label: 'Operating Systems', aliases: ['kernel development', 'systems programming'], category: 'domain' },
  { slug: 'supply-chain', label: 'Supply Chain', aliases: ['logistics', 'operations research'], category: 'domain' },
  { slug: 'sre', label: 'Site Reliability', aliases: ['sre', 'site reliability engineering', 'on-call', 'incident response'], category: 'practice' },
];
