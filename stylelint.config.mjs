export default {
  extends: ["stylelint-config-standard"],
  rules: {
    // The app ships hashed module classes, so the sheet matches them by
    // substring: the naming convention is not ours to keep.
    "selector-class-pattern": null,
    "custom-property-pattern": null,
    // Overriding a component's own rules is the whole point of the patch.
    "no-descending-specificity": null,
    // Formatting belongs to oxfmt, which does not insert blank lines.
    "rule-empty-line-before": null,
    // env() fallbacks and calc() read clearer with the unit kept.
    "length-zero-no-unit": null,
    // WebKit still needs the prefixed backdrop-filter.
    "property-no-vendor-prefix": null,
  },
};
