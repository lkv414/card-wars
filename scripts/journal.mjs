#!/usr/bin/env node
/**
 * journal.mjs — помощник журнала действий агентов (docs/journal/).
 * Конвенция и правила: .agents/skills/docs-journal/SKILL.md (канон: skills/docs-journal/SKILL.md)
 *
 * Команды:
 *   node scripts/journal.mjs path                 путь к файлу сегодняшнего дня (создаёт docs/journal/)
 *   node scripts/journal.mjs stamp                текущая метка "ГГГГ-ММ-ДД ЧЧ:ММ"
 *   node scripts/journal.mjs start "<заголовок>"  создать файл дня и секцию "## ЧЧ:ММ — <заголовок>"
 *   node scripts/journal.mjs list [N]             последние N файлов журнала (по умолчанию 10)
 *   node scripts/journal.mjs grep "<термин>"      поиск по всем записям (без учёта регистра)
 *   node scripts/journal.mjs read [ГГГГ-ММ-ДД]    вывести запись дня (по умолчанию — сегодня)
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "docs", "journal");

const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const clock = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

const fileFor = (date) => join(DIR, `${date}.md`);
const ensureDir = () => mkdirSync(DIR, { recursive: true });
const journalFiles = () =>
  existsSync(DIR)
    ? readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse()
    : [];

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "path": {
    ensureDir();
    console.log(fileFor(today));
    break;
  }

  case "stamp": {
    console.log(`${today} ${clock}`);
    break;
  }

  case "start": {
    const title = args.join(" ").trim();
    if (!title) {
      console.error('Использование: node scripts/journal.mjs start "<заголовок задачи>"');
      process.exit(1);
    }
    ensureDir();
    const file = fileFor(today);
    if (!existsSync(file)) appendFileSync(file, `# ${today}\n`, "utf8");
    let body = readFileSync(file, "utf8");
    if (!body.endsWith("\n")) body += "\n";
    appendFileSync(file, `\n## ${clock} — ${title}\n`, "utf8");
    console.log(file);
    break;
  }

  case "list": {
    const limit = Number.parseInt(args[0] ?? "10", 10) || 10;
    const files = journalFiles().slice(0, limit);
    if (!files.length) {
      console.log("Журнал пуст: docs/journal/ не содержит записей.");
      break;
    }
    for (const name of files) {
      const stat = statSync(join(DIR, name));
      const m = stat.mtime;
      const when = `${m.getFullYear()}-${pad(m.getMonth() + 1)}-${pad(m.getDate())} ${pad(m.getHours())}:${pad(m.getMinutes())}`;
      console.log(`${name}  ${String(stat.size).padStart(7)} B  обновлён ${when}`);
    }
    break;
  }

  case "grep": {
    const term = args.join(" ").trim();
    if (!term) {
      console.error('Использование: node scripts/journal.mjs grep "<термин>"');
      process.exit(1);
    }
    const needle = term.toLowerCase();
    let hits = 0;
    for (const name of journalFiles()) {
      const lines = readFileSync(join(DIR, name), "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (line.toLowerCase().includes(needle)) {
          hits += 1;
          console.log(`${name}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    if (!hits) console.log(`Совпадений по "${term}" нет.`);
    break;
  }

  case "read": {
    const date = args[0] ?? today;
    const file = fileFor(date);
    if (!existsSync(file)) {
      console.error(`Записи за ${date} нет: ${file}`);
      process.exit(1);
    }
    console.log(readFileSync(file, "utf8"));
    break;
  }

  default: {
    console.error(
      [
        "journal.mjs — журнал действий в docs/journal/",
        "",
        '  node scripts/journal.mjs path                 путь к файлу сегодняшнего дня',
        '  node scripts/journal.mjs stamp                метка "ГГГГ-ММ-ДД ЧЧ:ММ"',
        '  node scripts/journal.mjs start "<заголовок>"  создать файл дня и секцию записи',
        "  node scripts/journal.mjs list [N]             последние N записей",
        '  node scripts/journal.mjs grep "<термин>"      поиск по журналу',
        "  node scripts/journal.mjs read [ГГГГ-ММ-ДД]    вывести запись дня",
      ].join("\n"),
    );
    process.exit(command ? 1 : 0);
  }
}