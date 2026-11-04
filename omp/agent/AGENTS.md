# Basic coding policy

If you create a helper method that operates on an existing type but does not modify or extend its structure, implement it as an extension method. Prefer extension methods for adding behavior to existing types without altering their definitions. Avoid standalone static methods when an extension method provides clearer usage and better readability.
Use LSP if possible for navigating the code of some simple refactoring.
