(function () {
  const namespace = (window.AutoMcGraw = window.AutoMcGraw || {});

  function normalize(value) {
    return String(value == null ? "" : value)
      .replace(/\s+/g, " ")
      .trim();
  }

  function labelFor(choice, index) {
    const label = normalize(choice && choice.label);
    if (label) return label;
    return String.fromCharCode(65 + index);
  }

  function formatChoices(choices) {
    if (!Array.isArray(choices) || !choices.length) return "";
    return choices
      .map((choice, index) => `${labelFor(choice, index)}. ${normalize(choice.text)}`)
      .join("\n");
  }

  function openingFor(source) {
    switch (source) {
      case "canvas":
        return "Answer this question from an online course quiz.";
      case "ezto":
        return "Answer this question from an online course assignment. Show no working, just the final value.";
      default:
        return "Answer this question from an online course assignment.";
    }
  }

  function instructionsFor(questionType, blanks) {
    switch (questionType) {
      case "multiple-select":
        return 'Several choices are correct. "answer" must be an array of the exact choice labels, for example ["A", "C"].';
      case "fill-in-the-blank":
        return blanks > 1
          ? `There are ${blanks} boxes. "answer" must be an array of ${blanks} strings in the order the boxes are listed, each just the value with no units, percent sign, currency symbol or thousands separators.`
          : '"answer" must be only the value that belongs in the blank: no sentence around it, no units, no percent sign, no currency symbol and no thousands separators.';
      case "true-false":
        return '"answer" must be exactly "True" or "False".';
      case "matching-dnd":
        return blanks > 1
          ? ""
          : 'Each item on the left takes exactly one of the options. "answer" must be an array with one option per item, in the same order as the items, each copied word for word from the options list.';
      case "matching":
        return blanks > 1
          ? `There are ${blanks} dropdowns. "answer" must be an array of ${blanks} strings, each exactly matching one of that dropdown's listed options.`
          : '"answer" must be exactly one of the listed options.';
      default:
        return 'Exactly one choice is correct. "answer" must be that choice\'s label, for example "B".';
    }
  }

  function formatFields(fields) {
    if (!Array.isArray(fields) || !fields.length) return "";

    const informative = fields.some(
      (field) => field && (field.kind === "select" || normalize(field.label))
    );
    if (!informative) return "";

    return fields
      .map((field, index) => {
        const label = normalize(field && field.label);
        const name = label ? `${label}` : "(unlabelled)";
        if (field && field.kind === "select") {
          return `${index + 1}. ${name} - one of: ${(field.options || []).join(" | ")}`;
        }
        return `${index + 1}. ${name}`;
      })
      .join("\n");
  }

  function buildPrompt(questionData) {
    const data = questionData || {};
    const parts = [];

    parts.push(openingFor(data.source));
    parts.push(instructionsFor(data.questionType, data.blanks || 0));
    parts.push(
      'Reply with one JSON object and nothing else: no preamble, no code fence, no text after it. ' +
        'It must have exactly two keys, "answer" first and "explanation" second. ' +
        "Keep the explanation under 200 characters."
    );

    if (data.instructions) {
      parts.push(`Instructions: ${normalize(data.instructions)}`);
    }

    parts.push(`Question: ${normalize(data.questionText)}`);

    const choices = formatChoices(data.choices);
    if (choices) {
      parts.push(`Choices:\n${choices}`);
    }

    const fields = formatFields(data.fields);
    if (fields) {
      const heading = (data.fields || []).some((f) => f && f.kind === "select")
        ? "Dropdowns"
        : "Boxes to fill, in order";
      parts.push(`${heading}:\n${fields}`);
    }

    if (Array.isArray(data.terms) && data.terms.length) {
      parts.push(
        `Items to match, in order:\n${data.terms
          .map((term, index) => `${index + 1}. ${normalize(term)}`)
          .join("\n")}`
      );
    }

    if (Array.isArray(data.options) && data.options.length) {
      parts.push(
        `Options:\n${data.options.map((option) => `- ${normalize(option)}`).join("\n")}`
      );
    }

    parts.push('{"answer": ..., "explanation": "..."}');

    return parts.join("\n\n");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function toParagraphs(value) {
    return String(value)
      .split("\n")
      .map((line) => `<p>${escapeHtml(line) || "<br>"}</p>`)
      .join("");
  }

  namespace.escapeHtml = escapeHtml;
  namespace.toParagraphs = toParagraphs;
  namespace.normalize = normalize;
  namespace.labelFor = labelFor;
  namespace.buildPrompt = buildPrompt;
})();
