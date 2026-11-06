/**
 * Template step text (SPEC: Voiceover and AI text, "Template step text"). Keyed by the guide's
 * lang; v1 ships English and other languages fall back to it.
 */
import type { StepKind } from '../model/schema';
import { escapeMd } from './markdown';

export interface TemplateVars {
  name?: string;
  option?: string;
  pageTitle?: string;
  /** For check steps: state after the action; undefined when unknown. */
  checked?: boolean;
  /** Password, credit-card and one-time-code fields. */
  sensitive?: boolean;
}

type Templates = Record<Exclude<StepKind, 'note'>, (v: Required<Pick<TemplateVars, 'name'>> & TemplateVars) => string>;

const en: Templates = {
  click: (v) => `Click **${v.name}**`,
  input: (v) => (v.sensitive ? `Enter your ${v.name}` : `Enter ${v.name}`),
  select: (v) => (v.option ? `Choose **${v.option}** in **${v.name}**` : `Choose an option in **${v.name}**`),
  check: (v) => `${v.checked === false ? 'Uncheck' : v.checked === true ? 'Check' : 'Check (or uncheck)'} **${v.name}**`,
  submit: () => 'Submit the form',
  navigate: (v) => `Go to ${v.pageTitle ?? 'the next page'}`,
  // A menu that opens when the pointer rests on its trigger (D204).
  hover: (v) => `Point at **${v.name}**`,
};

const TEMPLATES: Record<string, Templates> = { en };

export function stepTitle(kind: Exclude<StepKind, 'note'>, vars: TemplateVars, lang = 'en'): string {
  const t = TEMPLATES[lang.split('-')[0]!.toLowerCase()] ?? en;
  return t[kind]({
    ...vars,
    name: escapeMd(vars.name ?? 'the element'),
    ...(vars.option !== undefined ? { option: escapeMd(vars.option) } : {}),
    ...(vars.pageTitle !== undefined ? { pageTitle: escapeMd(vars.pageTitle) } : {}),
  });
}

/** Custom dropdown option step: "Choose **{option}**". */
export function chooseOptionTitle(option: string): string {
  return `Choose **${escapeMd(option)}**`;
}

const ROLE_WORDS: Record<string, string> = {
  button: 'the button',
  link: 'the link',
  textbox: 'the field',
  searchbox: 'the search field',
  checkbox: 'the checkbox',
  radio: 'the option',
  switch: 'the switch',
  combobox: 'the dropdown',
  listbox: 'the list',
  option: 'the option',
  tab: 'the tab',
  menuitem: 'the menu item',
  slider: 'the slider',
  spinbutton: 'the number field',
};

export function roleWord(role: string | undefined): string {
  return (role && ROLE_WORDS[role]) ?? 'the element';
}
