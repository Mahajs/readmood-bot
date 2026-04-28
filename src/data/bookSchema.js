const requiredBookFields = [
  "title",
  "author",
  "genre",
  "mood",
  "format",
  "length",
  "goal",
  "description",
  "recommendationText",
  "vibe",
  "themes",
  "pace",
  "complexity",
];

const allowedBookGenres = [
  "художественная литература",
  "фэнтези",
  "фантастика",
  "психология",
  "история",
  "саморазвитие",
  "продуктивность",
];

const allowedBookPaces = ["slow", "medium", "fast", "very_fast"];

const allowedBookComplexities = ["low", "medium", "high"];

module.exports = {
  requiredBookFields,
  allowedBookGenres,
  allowedBookPaces,
  allowedBookComplexities,
};
