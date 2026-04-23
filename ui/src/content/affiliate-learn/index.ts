import { FOUNDATIONS_GUIDES } from "./foundations";
import { PRODUCT_GUIDES } from "./products";
import { BUNDLE_GUIDES } from "./bundles";
import { OBJECTION_GUIDES } from "./objections";
import type { LearnGuide, LearnSection } from "./types";

export const LEARN_GUIDES: LearnGuide[] = [
  ...FOUNDATIONS_GUIDES,
  ...PRODUCT_GUIDES,
  ...BUNDLE_GUIDES,
  ...OBJECTION_GUIDES,
];

export function getGuideBySlug(slug: string): LearnGuide | undefined {
  return LEARN_GUIDES.find((g) => g.slug === slug);
}

export function getGuidesBySection(section: LearnSection): LearnGuide[] {
  return LEARN_GUIDES.filter((g) => g.section === section);
}

export { SECTION_META } from "./types";
export type {
  LearnGuide,
  LearnSection,
  GuideStep,
  GuideCallout,
  CalloutKind,
  Visual,
} from "./types";
