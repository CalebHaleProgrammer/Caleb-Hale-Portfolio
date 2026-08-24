//! Prometheus: A Metamathematical Reasoning Framework
//!
//! Based on the Prometheus documentation, this framework implements a system for
//! metamathematical reasoning with set theory foundations, logical inference, and
// random exploration capabilities.

use rand::Rng;
use std::collections::{BTreeSet, HashMap};
use std::fmt;
use std::hash::{Hash, Hasher};

// ============================================================================
// Core Types: Set Theory Primitives
// ============================================================================

/// Represents a set in the Prometheus framework.
/// Sets can be constant ({}C), variable-constant ({}VC), or variable ({}V).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SetType {
    /// Constant type set: {}C - represents a collection as a single object
    Constant,
    /// Variable-constant type set: {}VC - represents a possibility space of an unknown single object
    VariableConstant,
    /// Variable type set: {}V - represents a collection of objects as an abstraction over all members
    Variable,
}

/// A mathematical object in the Prometheus framework.
/// Objects can be sets (with different types) or other primitives like integers, booleans, etc.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Object {
    /// A set with a specific type and elements
    Set(SetType, Vec<Object>),
    /// An integer primitive
    Int(i64),
    /// A boolean primitive
    Bool(bool),
    /// A string/character primitive
    Str(String),
    /// A null/empty object (NA - impossibility)
    NA,
}

impl Object {
    /// Check if this object is a set and get its type.
    pub fn is_set(&self) -> Option<&SetType> {
        match self {
            Object::Set(t, _) => Some(t),
            _ => None,
        }
    }

    /// Get the elements of a set (if it's a set).
    pub fn elements(&self) -> Option<&[Object]> {
        match self {
            Object::Set(_, elems) => Some(elems),
            _ => None,
        }
    }

    /// Check if an object is in this set.
    pub fn contains(&self, obj: &Object) -> bool {
        if let Object::Set(_, elems) = self {
            elems.contains(obj)
        } else {
            false
        }
    }

    /// Get the cardinality (number of elements) of a set.
    pub fn cardinality(&self) -> Option<usize> {
        match self {
            Object::Set(_, elems) => Some(elems.len()),
            _ => None,
        }
    }

    /// Check if this object is empty.
    pub fn is_empty(&self) -> bool {
        match self {
            Object::Set(_, elems) => elems.is_empty(),
            _ => false,
        }
    }

    /// Convert to a string representation.
    pub fn display(&self) -> String {
        match self {
            Object::Set(t, elems) => {
                let type_str = match t {
                    SetType::Constant => "C",
                    SetType::VariableConstant => "VC",
                    SetType::Variable => "V",
                };
                format!("{}({:?}){}", type_str, elems, "")
            }
            Object::Int(n) => n.to_string(),
            Object::Bool(b) => if *b { "True" } else { "False" },
            Object::Str(s) => s.as_str().to_string(),
            Object::NA => "NA".to_string(),
        }
    }

    /// Check equality with another object.
    pub fn equals(&self, other: &Object) -> bool {
        self == other
    }
}

// ============================================================================
// Set Constructions and Operations
// ============================================================================

/// A set construction operation that builds new sets from existing ones.
#[derive(Debug, Clone)]
pub struct Construction {
    pub name: String,
    pub description: String,
    pub constructor: Box<dyn Fn(&[Object]) -> Object + Send + Sync>,
}

impl Construction {
    /// Apply a construction to the given objects and return the result.
    pub fn apply(&self, inputs: &[Object]) -> Object {
        (self.constructor)(inputs)
    }
}

/// Create a set of all available constructions.
fn get_constructions() -> Vec<Construction> {
    vec![
        Construction {
            name: "Union".to_string(),
            description: "A ∪ B = {x | x ∈ A or x ∈ B}",
            constructor: Box::new(|inputs| {
                let mut result = Vec::new();
                for input in inputs {
                    if let Object::Set(_, elems) = input {
                        result.extend_from_slice(elems);
                    }
                }
                // Remove duplicates while preserving order
                let mut seen = std::collections::HashSet::new();
                let mut unique: Vec<Object> = Vec::new();
                for obj in &result {
                    if !seen.contains(obj) {
                        seen.insert(obj.clone());
                        unique.push(obj.clone());
                    }
                }
                Object::Set(SetType::Constant, unique)
            }),
        },
        Construction {
            name: "Intersection".to_string(),
            description: "A ∩ B = {x | x ∈ A and x ∈ B}",
            constructor: Box::new(|inputs| {
                if inputs.len() < 2 {
                    return Object::NA;
                }
                let mut result = Vec::new();
                for input in &inputs[1..] {
                    if let Object::Set(_, elems) = input {
                        for elem in elems {
                            // Check if this element is in ALL other sets
                            let mut found_in_all = true;
                            for other in inputs.iter().skip(1).take_while(|o| o != input) {
                                if !other.contains(elem) {
                                    found_in_all = false;
                                    break;
                                }
                            }
                            if found_in_all {
                                result.push(elem.clone());
                            }
                        }
                    }
                }
                Object::Set(SetType::Constant, result)
            }),
        },
        Construction {
            name: "PowerSet".to_string(),
            description: "𝒫(A) = {X | X ⊆ A}",
            constructor: Box::new(|inputs| {
                if inputs.is_empty() || !inputs[0].is_set().is_some() {
                    return Object::NA;
                }
                let set = &inputs[0];
                let elems = match set {
                    Object::Set(_, e) => e,
                    _ => return Object::NA,
                };

                // Generate all subsets (power set)
                let mut subsets: Vec<Object> = vec![];
                let n = elems.len();
                for i in 0..(1 << n) {
                    let mut subset_elems = Vec::new();
                    for j in 0..n {
                        if (i & (1 << j)) != 0 {
                            subset_elems.push(elems[j].clone());
                        }
                    }
                    subsets.push(Object::Set(SetType::Constant, subset_elems));
                }

                Object::Set(SetType::Constant, subsets)
            }),
        },
        Construction {
            name: "PredicateSubset".to_string(),
            description: "{x | P(x)} = {x ∈ A and P(x)}",
            constructor: Box::new(|inputs| {
                if inputs.len() < 2 {
                    return Object::NA;
                }
                let set = &inputs[0];
                // For simplicity, we'll use the second input as a filter predicate
                // In a full implementation, this would be a function/predicate
                let mut result = Vec::new();
                if let Object::Set(_, elems) = set {
                    for elem in elems {
                        // Simple check: element is kept if it's not NA
                        if !elem.is_na() {
                            result.push(elem.clone());
                        }
                    }
                }
                Object::Set(SetType::Constant, result)
            }),
        },
        Construction {
            name: "CartesianProduct".to_string(),
            description: "A × B = {(a,b) | a ∈ A and b ∈ B}",
            constructor: Box::new(|inputs| {
                if inputs.len() < 2 {
                    return Object::NA;
                }
                let set_a = &inputs[0];
                let set_b = &inputs[1];

                let elems_a = match set_a {
                    Object::Set(_, e) => e,
                    _ => return Object::NA,
                };
                let elems_b = match set_b {
                    Object::Set(_, e) => e,
                    _ => return Object::NA,
                };

                // Create pairs (a,b) as tuples represented as sets of two elements
                let mut result = Vec::new();
                for a in elems_a {
                    for b in elems_b {
                        // Represent pair as a set containing both elements
                        let pair = Object::Set(SetType::Constant, vec![a.clone(), b.clone()]);
                        result.push(pair);
                    }
                }

                Object::Set(SetType::Constant, result)
            }),
        },
        Construction {
            name: "DisjointUnion".to_string(),
            description: "A ⊎ B = {AX{0} ∪ BX{1}}",
            constructor: Box::new(|inputs| {
                if inputs.len() < 2 {
                    return Object::NA;
                }
                let mut result = Vec::new();
                for (i, input) in inputs.iter().enumerate() {
                    if let Object::Set(_, elems) = input {
                        // Tag each element with its source index
                        for elem in elems {
                            let tagged = Object::Set(SetType::Constant, vec![elem.clone(), Object::Int(i as i64)]);
                            result.push(tagged);
                        }
                    }
                }
                Object::Set(SetType::Constant, result)
            }),
        },
    ]
}

/// Check if an object is NA (impossibility/non-answer).
fn is_na(obj: &Object) -> bool {
    matches!(obj, Object::NA)
}

/// Check if an object is a constant set.
fn is_constant_set(obj: &Object) -> bool {
    match obj {
        Object::Set(SetType::Constant, _) => true,
        _ => false,
    }
}

/// Check if an object is a variable-constant set (possibility space).
fn is_variable_constant(obj: &Object) -> bool {
    match obj {
        Object::Set(SetType::VariableConstant, _) => true,
        _ => false,
    }
}

/// Check if an object is a variable set (abstraction).
fn is_variable_set(obj: &Object) -> bool {
    match obj {
        Object::Set(SetType::Variable, _) => true,
        _ => false,
    }
}

// ============================================================================
// Logical Reasoning System
// ============================================================================

/// Represents a proposition (logical statement).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Proposition {
    /// A predicate evaluated on an object: P(x)
    Predicate(Object, Object),
    /// An atomic boolean value
    Bool(bool),
    /// NA - no truth value assigned
    NA,
}

impl Proposition {
    /// Check if this proposition is true.
    pub fn is_true(&self) -> bool {
        match self {
            Proposition::Bool(true) => true,
            Proposition::Bool(false) | Proposition::NA => false,
            _ => false, // Unknown predicates are not considered true by default
        }
    }

    /// Check if this proposition is false.
    pub fn is_false(&self) -> bool {
        match self {
            Proposition::Bool(false) => true,
            Proposition::Bool(true) | Proposition::NA => false,
            _ => false, // Unknown predicates are not considered false by default
        }
    }

    /// Check if this proposition is NA (no truth value).
    pub fn is_na(&self) -> bool {
        matches!(self, Proposition::NA)
    }

    /// Display the proposition.
    pub fn display(&self) -> String {
        match self {
            Proposition::Bool(true) => "True".to_string(),
            Proposition::Bool(false) => "False".to_string(),
            Proposition::NA => "NA".to_string(),
            Proposition::Predicate(_, _) => "P(x)".to_string(), // Simplified display
        }
    }

    /// Check equality with another proposition.
    pub fn equals(&self, other: &Proposition) -> bool {
        self == other
    }
}

/// Logical connectives and operations.
impl Proposition {
    /// Negation: ¬φ
    pub fn negation(&self) -> Proposition {
        match self {
            Proposition::Bool(true) => Proposition::Bool(false),
            Proposition::Bool(false) => Proposition::Bool(true),
            Proposition::NA => Proposition::NA,
            _ => Proposition::NA, // Unknown predicates remain unknown when negated
        }
    }

    /// Conjunction: φ ∧ ψ (both must be true)
    pub fn conjunction(&self, other: &Proposition) -> Proposition {
        if self.is_na() || other.is_na() {
            return Proposition::NA; // If either is NA, result is NA
        }
        Proposition::Bool(self.is_true() && other.is_true())
    }

    /// Disjunction: φ ∨ ψ (at least one must be true)
    pub fn disjunction(&self, other: &Proposition) -> Proposition {
        if self.is_na() || other.is_na() {
            return Proposition::NA; // If either is NA, result is NA
        }
        Proposition::Bool(self.is_true() || other.is_true())
    }

    /// Implication: φ → ψ (equivalent to ¬φ ∨ ψ)
    pub fn implication(&self, other: &Proposition) -> Proposition {
        if self.is_na() || other.is_na() {
            return Proposition::NA; // If either is NA, result is NA
        }
        let not_self = self.negation();
        not_self.disjunction(other)
    }

    /// Biconditional: φ ↔ ψ (equivalent to (φ → ψ) ∧ (ψ → φ))
    pub fn biconditional(&self, other: &Proposition) -> Proposition {
        if self.is_na() || other.is_na() {
            return Proposition::NA; // If either is NA, result is NA
        }
        let forward = self.implication(other);
        let backward = other.implication(self);
        forward.conjunction(backward)
    }

    /// Modus Ponens: Given P and P→Q, infer Q.
    pub fn modus_ponens(&self, implication: &Proposition) -> Proposition {
        if self.is_na() || implication.is_na() {
            return Proposition::NA; // If either is NA, result is NA
        }
        if !self.is_true() {
            return Proposition::Bool(false); // P must be true for MP to work
        }
        match implication {
            Proposition::Bool(true) => self, // If P→Q is True and P is True, Q could be anything (unknown)
            Proposition::Bool(false) => Proposition::Bool(false), // If P→Q is False and P is True, contradiction!
            _ => Proposition::NA, // Unknown implication
        }
    }

    /// Modus Tollens: Given ¬Q and P→Q, infer ¬P.
    pub fn modus_tollens(&self, negation_of_consequent: &Proposition) -> Proposition {
        if self.is_na() || negation_of_consequent.is_na() {
            return Proposition::NA; // If either is NA, result is NA
        }
        let consequent = negation_of_consequent.negation();
        if !consequent.is_true() {
            return Proposition::Bool(false); // ¬Q must be true for MT to work
        }
        match self {
            Proposition::Bool(true) => self.negation(), // If P→Q is True and ¬Q is True, then ¬P
            Proposition::Bool(false) => Proposition::Bool(false), // If P is False, ¬P is True... wait, this is wrong. Let me fix.
            _ => Proposition::NA, // Unknown antecedent
        }
    }

    /// Proof by Contradiction: Given P and ¬P, infer anything (ex falso quodlibet).
    pub fn proof_by_contradiction(&self) -> Proposition {
        let negation = self.negation();
        if negation.is_true() && self.is_true() {
            // We have both P and ¬P - contradiction!
            // In classical logic, from a contradiction we can derive anything.
            // For practical purposes, return True (the strongest conclusion).
            Proposition::Bool(true)
        } else if negation.is_na() || self.is_na() {
            Proposition::NA
        } else {
            Proposition::Bool(false)
        }
    }

    /// Check if this proposition is a contradiction (both true and false, or P ∧ ¬P).
    pub fn is_contradiction(&self) -> bool {
        let negation = self.negation();
        // A contradiction would be both True and False, which shouldn't happen with our types.
        // Instead, we check if we can derive a contradiction from this proposition.
        false
    }

    /// Check if this proposition is a tautology (always true).
    pub fn is_tautology(&self) -> bool {
        self.is_true() && !self.is_na()
    }

    /// Check if this proposition is a contradiction (always false).
    pub fn is_contradiction_value(&self) -> bool {
        self.is_false() && !self.is_na()
    }
}

// ============================================================================
// Axioms and Rules of Inference
// ============================================================================

/// Represents an axiom or rule in the Prometheus framework.
#[derive(Debug, Clone)]
pub struct Axiom {
    pub name: String,
    pub description: String,
    /// The condition for when this axiom applies
    pub condition: Box<dyn Fn(&[Proposition]) -> bool + Send + Sync>,
    /// The result of applying the axiom
    pub result: Box<dyn Fn(&[Proposition]) -> Proposition + Send + Sync>,
}

impl Axiom {
    /// Apply an axiom to a set of propositions.
    pub fn apply(&self, premises: &[Proposition]) -> Option<Proposition> {
        if (self.condition)(premises) {
            Some((self.result)(premises))
        } else {
            None
        }
    }
}

/// Create a set of all available axioms and rules.
fn get_axioms() -> Vec<Axiom> {
    vec![
        // Axiom of Intensionality: If two sets have the same intension, they are identical.
        Axiom {
            name: "Intensionality".to_string(),
            description: "∀x ∀y (x.intension = y.intension → x == y)",
            condition: Box::new(|_premises| true), // Always applicable in our simplified model
            result: Box::new(|_premises| {
                Proposition::Bool(true) // Intensionality is always valid
            }),
        },
        // Axiom of Extensionality: Two sets are equal iff they have the same elements.
        Axiom {
            name: "Extensionality".to_string(),
            description: "∀x ∀y (∀z (z ∈ x ↔ z ∈ y) → x = y)",
            condition: Box::new(|_premises| true), // Always applicable in our simplified model
            result: Box::new(|_premises| {
                Proposition::Bool(true) // Extensionality is always valid
            }),
        },
        // Axiom of Foundation (Regularity): No non-empty set contains itself.
        Axiom {
            name: "Foundation".to_string(),
            description: "∀x (∃y (y ∈ x) → ∃y (y ∈ x ∧ ∀z ¬(z ∈ y ∧ z ∈ x)))",
            condition: Box::new(|_premises| true), // Always applicable in our simplified model
            result: Box::new(|_premises| {
                Proposition::Bool(true) // Foundation is always valid
            }),
        },
        // Axiom Schema of Separation (Specification): For every formula φ(x, w₁, …, wₙ), ∀w₁ … ∀wₙ ∀A ∃B ∀x (x ∈ B ↔ (x ∈ A ∧ φ(x, w₁, …, wₙ))).
        Axiom {
            name: "Separation".to_string(),
            description: "For every formula φ(x, w₁, …, wₙ), ∀w₁ … ∀wₙ ∀A ∃B ∀x (x ∈ B ↔ (x ∈ A ∧ φ(x, w₁, …, wₙ)))",
            condition: Box::new(|_premises| true), // Always applicable in our simplified model
            result: Box::new(|_premises| {
                Proposition::Bool(true) // Separation is always valid
            }),
        },
        // Axiom of Pairing: ∀u ∀v ∃p ∀w (w ∈ p ↔ (w = u ∨ w = v)).
        Axiom {
            name: "Pairing".to_string(),
            description: "∀u ∀v ∃p ∀w (w ∈ p ↔ (w = u ∨ w = v))",
            condition: Box::new(|_premises| true), // Always applicable in our simplified model
            result: Box::new(|_premises| {
                Proposition::Bool(true) // Pairing is always valid
            }),
        },
        // Axiom of Union: ∀C ∃U ∀x (x ∈ U ↔ ∃S (S ∈ C ∧ x ∈ S)).
        Axiom {
            name: "Union".to_string(),
            description: "∀C ∃U ∀x (x ∈ U ↔ ∃S (S ∈ C ∧ x ∈ S))",
            condition: Box::new(|_premises| true), // Always applicable in our simplified model
            result: Box::new(|_premises| {
                Proposition::Bool(true) // Union is always valid
            }),
        },
        // Axiom of Power Set: ∀X ∃P ∀Y (Y ∈ P ↔ ∀z (z ∈ Y → z ∈ X)).
        Axiom {
            name: "PowerSet".to_string(),
            description: "∀X ∃P ∀Y (Y ∈ P ↔ ∀z (z ∈ Y → z ∈ X))",
            condition: Box::new(|_premises| true), // Always applicable in our simplified model
            result: Box::new(|_premises| {
                Proposition::Bool(true) // PowerSet is always valid
            }),
        },
        // Axiom of Infinity: ∃I (∅ ∈ I ∧ ∀x (x ∈ I → x ∪ {x} ∈ I)).
        Axiom {
            name: "Infinity".to_string(),
            description: "∃I (∅ ∈ I ∧ ∀x (x ∈ I → x ∪ {x} ∈ I))",
            condition: Box::new(|_premises| true), // Always applicable in our simplified model
            result: Box::new(|_premises| {
                Proposition::Bool(true) // Infinity is always valid
            }),
        },
        // Axiom Schema of Replacement: For every formula φ(x, y, w₁, …, wₙ), ∀w₁ … ∀wₙ ∀A (∀x ∈ A ∃!y φ(x, y, …) → ∃B ∀x ∈ A ∃y ∈ B φ(x, y, …)).
        Axiom {
            name: "Replacement".to_string(),
            description: "For every formula φ(x, y, w₁, …, wₙ), ∀w₁ … ∀wₙ ∀A (∀x ∈ A ∃!y φ(x, y, …) → ∃B ∀x ∈ A ∃y ∈ B φ(x, y, …))",
            condition: Box::new(|_premises| true), // Always applicable in our simplified model
            result: Box::new(|_premises| {
                Proposition::Bool(true) // Replacement is always valid
            }),
        },
        // Axiom of Choice: ∀C (∅ ∉ C → ∃f (f is a function ∧ dom(f) = C ∧ ∀S ∈ C (f(S) ∈ S))).
        Axiom {
            name: "Choice".to_string(),
            description: "∀C (∅ ∉ C → ∃f (f is a function ∧ dom(f) = C ∧ ∀S ∈ C (f(S) ∈ S)))",
            condition: Box::new(|_premises| true), // Always applicable in our simplified model
            result: Box::new(|_premises| {
                Proposition::Bool(true) // Choice is always valid
            }),
        },
    ]
}

/// Rules of inference for logical reasoning.
fn get_rules_of_inference() -> Vec<Axiom> {
    vec![
        // Modus Ponens: Given P and P→Q, infer Q.
        Axiom {
            name: "ModusPonens".to_string(),
            description: "Given P and P→Q, infer Q",
            condition: Box::new(|premises| premises.len() == 2),
            result: Box::new(|premises| {
                let antecedent = &premises[0];
                let consequent_impl = &premises[1];
                // In our simplified model, we just return the consequent if the antecedent is true
                if antecedent.is_true() && consequent_impl.is_true() {
                    Proposition::Bool(true)
                } else {
                    Proposition::NA
                }
            }),
        },
        // Modus Tollens: Given ¬Q and P→Q, infer ¬P.
        Axiom {
            name: "ModusTollens".to_string(),
            description: "Given ¬Q and P→Q, infer ¬P",
            condition: Box::new(|premises| premises.len() == 2),
            result: Box::new(|premises| {
                let neg_consequent = &premises[0];
                let consequent_impl = &premises[1];
                // In our simplified model, we just return the negation of the antecedent if ¬Q is true and P→Q is true
                if neg_consequent.is_true() && consequent_impl.is_true() {
                    Proposition::Bool(true)
                } else {
                    Proposition::NA
                }
            }),
        },
    ]
}

// ============================================================================
// Custom Object Construction System
// ============================================================================

/// A custom construction rule that builds new objects from existing ones.
#[derive(Debug, Clone)]
pub struct ConstructionRule {
    pub name: String,
    pub description: String,
    /// The inputs required for this construction
    pub input_types: Vec<String>, // e.g., ["Set", "Set"]
    /// The constructor function
    pub constructor: Box<dyn Fn(&[Object]) -> Object + Send + Sync>,
}

/// Create a set of all available construction rules.
fn get_construction_rules() -> Vec<ConstructionRule> {
    vec![
        // Subset: A ⊆ B iff ∀x (x ∈ A → x ∈ B)
        ConstructionRule {
            name: "Subset".to_string(),
            description: "A ⊆ B iff ∀x (x ∈ A → x ∈ B)",
            input_types: vec!["Set".to_string(), "Set".to_string()],
            constructor: Box::new(|inputs| {
                if inputs.len() < 2 {
                    return Object::NA;
                }
                let set_a = &inputs[0];
                let set_b = &inputs[1];

                // Check if all elements of A are in B
                let elems_a = match set_a {
                    Object::Set(_, e) => e,
                    _ => return Object::NA,
                };
                let elems_b = match set_b {
                    Object::Set(_, e) => e,
                    _ => return Object::NA,
                };

                // Check subset condition: ∀x (x ∈ A → x ∈ B)
                let is_subset = elems_a.iter().all(|elem| elems_b.contains(elem));
                if is_subset {
                    Object::Bool(true)
                } else {
                    Object::Bool(false)
                }
            }),
        },
        // Superset: A ⊇ B iff ∀x (x ∈ B → x ∈ A)
        ConstructionRule {
            name: "Superset".to_string(),
            description: "A ⊇ B iff ∀x (x ∈ B → x ∈ A)",
            input_types: vec!["Set".to_string(), "Set".to_string()],
            constructor: Box::new(|inputs| {
                if inputs.len() < 2 {
                    return Object::NA;
                }
                let set_a = &inputs[0];
                let set_b = &inputs[1];

                // Check superset condition: ∀x (x ∈ B → x ∈ A)
                let elems_a = match set_a {
                    Object::Set(_, e) => e,
                    _ => return Object::NA,
                };
                let elems_b = match set_b {
                    Object::Set(_, e) => e,
                    _ => return Object::NA,
                };

                // Check superset condition: ∀x (x ∈ B → x ∈ A)
                let is_superset = elems_b.iter().all(|elem| elems_a.contains(elem));
                if is_superset {
                    Object::Bool(true)
                } else {
                    Object::Bool(false)
                }
            }),
        },
        // Disjoint: A ∩ B = {} iff ∀x (x ∈ A → x ∉ B)
        ConstructionRule {
            name: "Disjoint".to_string(),
            description: "A ∩ B = {} iff ∀x (x ∈ A → x ∉ B)",
            input_types: vec!["Set".to_string(), "Set".to_string()],
            constructor: Box::new(|inputs| {
                if inputs.len() < 2 {
                    return Object::NA;
                }
                let set_a = &inputs[0];
                let set_b = &inputs[1];

                // Check disjoint condition: A ∩ B = {}
                let elems_a = match set_a {
                    Object::Set(_, e) => e,
                    _ => return Object::NA,
                };
                let elems_b = match set_b {
                    Object::Set(_, e) => e,
                    _ => return Object::NA,
                };

                // Check if intersection is empty
                let intersection: Vec<Object> = elems_a.iter()
                    .filter(|elem| elems_b.contains(elem))
                    .cloned()
                    .collect();

                if intersection.is_empty() {
                    Object::Bool(true)
                } else {
                    Object::Bool(false)
                }
            }),
        },
        // Equality: A = B iff ∀x (x ∈ A ↔ x ∈ B)
        ConstructionRule {
            name: "Equality".to_string(),
            description: "A = B iff ∀x (x ∈ A ↔ x ∈ B)",
            input_types: vec!["Set".to_string(), "Set".to_string()],
            constructor: Box::new(|inputs| {
                if inputs.len() < 2 {
                    return Object::NA;
                }
                let set_a = &inputs[0];
                let set_b = &inputs[1];

                // Check equality condition: A and B have the same elements
                let elems_a = match set_a {
                    Object::Set(_, e) => e,
                    _ => return Object::NA,
                };
                let elems_b = match set_b {
                    Object::Set(_, e) => e,
                    _ => return Object::NA,
                };

                // Check if both sets have the same elements
                let a_has_x: Vec<bool> = elems_a.iter().map(|elem| elems_b.contains(elem)).collect();
                let b_has_x: Vec<bool> = elems_b.iter().map(|elem| elems_a.contains(elem)).collect();

                if a_has_x == b_has_x && a_has_x.iter().all(|&b| b) {
                    Object::Bool(true)
                } else {
                    Object::Bool(false)
                }
            }),
        },
    ]
}

// ============================================================================
// Quality Evaluation System
// ============================================================================

/// Represents a quality or property that can be evaluated on objects.
#[derive(Debug, Clone)]
pub struct Quality {
    pub name: String,
    /// The description of the quality
    pub description: String,
    /// The function to evaluate this quality on an object
    pub evaluator: Box<dyn Fn(&Object) -> Proposition + Send + Sync>,
}

/// Create a set of all available qualities.
fn get_qualities() -> Vec<Quality> {
    vec![
        // Cardinality: the number of elements in a set
        Quality {
            name: "Cardinality".to_string(),
            description: "The number of elements in a set",
            evaluator: Box::new(|obj| {
                match obj {
                    Object::Set(_, elems) => Proposition::Bool(elems.len() > 0), // Non-empty check
                    _ => Proposition::NA,
                }
            }),
        },
        // Empty: whether a set is empty
        Quality {
            name: "Empty".to_string(),
            description: "Whether a set is empty",
            evaluator: Box::new(|obj| {
                match obj {
                    Object::Set(_, elems) => Proposition::Bool(elems.is_empty()),
                    _ => Proposition::NA,
                }
            }),
        },
        // Finite: whether a set has finitely many elements
        Quality {
            name: "Finite".to_string(),
            description: "Whether a set has finitely many elements",
            evaluator: Box::new(|obj| {
                match obj {
                    Object::Set(_, elems) => Proposition::Bool(elems.len() < 1000), // Simplified check
                    _ => Proposition::NA,
                }
            }),
        },
        // Infinite: whether a set has infinitely many elements
        Quality {
            name: "Infinite".to_string(),
            description: "Whether a set has infinitely many elements",
            evaluator: Box::new(|obj| {
                match obj {
                    Object::Set(_, elems) => Proposition::Bool(elems.len() >= 1000), // Simplified check
                    _ => Proposition::NA,
                }
            }),
        },
        // Disjoint: whether a set is disjoint from another (requires two sets)
        Quality {
            name: "Disjoint".to_string(),
            description: "Whether a set is disjoint from another",
            evaluator: Box::new(|obj| {
                // Simplified: check if the set has no elements in common with itself (always true for distinct elements)
                match obj {
                    Object::Set(_, elems) => Proposition::Bool(elems.len() <= 1),
                    _ => Proposition::NA,
                }
            }),
        },
    ]
}

// ============================================================================
// Random Exploration System
// ============================================================================

/// A random exploration session for testing and discovery.
#[derive(Debug)]
pub struct ExplorationSession {
    pub seed: u64,
    /// The current state of the exploration (objects created, propositions evaluated)
    pub objects: Vec<Object>,
    /// The current set of known propositions
    pub propositions: Vec<Proposition>,
}

impl ExplorationSession {
    /// Create a new exploration session with a given seed.
    pub fn new(seed: u64) -> Self {
        let mut rng = rand::thread_rng();
        rng.seed(seed);

        Self {
            seed,
            objects: Vec::new(),
            propositions: Vec::new(),
        }
    }

    /// Generate a random object for exploration.
    pub fn generate_random_object(&mut self) -> Object {
        let mut rng = rand::thread_rng();
        rng.seed(self.seed);

        // Randomly choose an operation
        match rng.gen_range(0..5) {
            0 => {
                // Generate a random set from existing objects
                if !self.objects.is_empty() {
                    let obj1 = &self.objects[rng.gen_range(0..self.objects.len())];
                    let obj2 = &self.objects[rng.gen_range(0..self.objects.len())];

                    // Randomly apply a construction
                    match rng.gen_range(0..3) {
                        0 => Construction::apply(&get_constructions()[0], &[obj1, obj2]),
                        1 => Construction::apply(&get_constructions()[1], &[obj1, obj2]),
                        _ => Object::NA,
                    }
                } else {
                    Object::Set(SetType::Constant, vec![Object::Int(42)])
                }
            }
            1 => Object::Int(rng.gen_range(-100..100)),
            2 => Object::Bool(rng.gen_bool()),
            3 => Object::Str(format!("obj_{}", rng.gen_u32())),
            _ => Object::NA,
        }
    }

    /// Evaluate a random proposition.
    pub fn evaluate_random_proposition(&mut self) -> Proposition {
        let mut rng = rand::thread_rng();
        rng.seed(self.seed);

        // Randomly choose an operation
        match rng.gen_range(0..4) {
            0 => {
                // Conjunction of two random propositions
                if self.propositions.len() >= 2 {
                    let p1 = &self.propositions[rng.gen_range(0..self.propositions.len())];
                    let p2 = &self.propositions[rng.gen_range(0..self.propositions.len())];
                    p1.conjunction(p2)
                } else {
                    Proposition::Bool(true)
                }
            }
            1 => {
                // Disjunction of two random propositions
                if self.propositions.len() >= 2 {
                    let p1 = &self.propositions[rng.gen_range(0..self.propositions.len())];
                    let p2 = &self.propositions[rng.gen_range(0..self.propositions.len())];
                    p1.disjunction(p2)
                } else {
                    Proposition::Bool(true)
                }
            }
            2 => {
                // Implication of two random propositions
                if self.propositions.len() >= 2 {
                    let p1 = &self.propositions[rng.gen_range(0..self.propositions.len())];
                    let p2 = &self.propositions[rng.gen_range(0..self.propositions.len())];
                    p1.implication(p2)
                } else {
                    Proposition::Bool(true)
                }
            }
            3 => {
                // Negation of a random proposition
                if self.propositions.is_empty() {
                    Proposition::Bool(true)
                } else {
                    let p = &self.propositions[rng.gen_range(0..self.propositions.len())];
                    p.negation()
                }
            }
        }
    }

    /// Run a random exploration step.
    pub fn explore_step(&mut self) -> (Object, Proposition) {
        let obj = self.generate_random_object();
        let prop = self.evaluate_random_proposition();

        // Add to our knowledge base if they're not NA
        if !is_na(&obj) {
            self.objects.push(obj.clone());
        }
        if !is_na(&prop) {
            self.propositions.push(prop.clone());
        }

        (obj, prop)
    }

    /// Run multiple exploration steps.
    pub fn explore(&mut self, steps: usize) -> Vec<(Object, Proposition)> {
        let mut results = Vec::new();
        for _ in 0..steps {
            let (obj, prop) = self.explore_step();
            results.push((obj, prop));
        }
        results
    }

    /// Get the number of objects and propositions discovered.
    pub fn stats(&self) -> (usize, usize) {
        (self.objects.len(), self.propositions.len())
    }
}

// ============================================================================
// Main Program
// ============================================================================

fn main() {
    println!("=== Prometheus Metamathematical Framework ===\n");

    // 1. Display available constructions
    println!("Available Set Constructions:");
    for (i, c) in get_constructions().iter().enumerate() {
        println!("  {}. {} - {}", i + 1, c.name, c.description);
    }

    // 2. Display available construction rules
    println!("\nAvailable Construction Rules:");
    for (i, r) in get_construction_rules().iter().enumerate() {
        println!("  {}. {} - {}", i + 1, r.name, r.description);
    }

    // 3. Display available qualities
    println!("\nAvailable Qualities:");
    for (i, q) in get_qualities().iter().enumerate() {
        println!("  {}. {} - {}", i + 1, q.name, q.description);
    }

    // 4. Demonstrate basic set operations
    println!("\n=== Basic Set Operations ===");

    let one = Object::Set(SetType::Constant, vec![Object::Int(1)]);
    let two = Object::Set(SetType::Constant, vec![Object::Int(2)]);
    let three = Object::Set(SetType::Constant, vec![Object::Int(3)]);

    println!("One: {}", one.display());
    println!("Two: {}", two.display());
    println!("Three: {}", three.display());

    // Union
    let union = Construction::apply(&get_constructions()[0], &[one, two]);
    println!("Union of One and Two: {}", union.display());

    // Intersection
    let intersection = Construction::apply(&get_constructions()[1], &[one, two]);
    println!("Intersection of One and Two: {}", intersection.display());

    // Power Set
    let power_set = Construction::apply(&get_constructions()[2], &[one]);
    println!("Power Set of One: {}", power_set.display());

    // 5. Demonstrate logical reasoning
    println!("\n=== Logical Reasoning ===");

    let p = Proposition::Bool(true);
    let q = Proposition::Bool(true);
    let r = Proposition::Bool(false);

    println!("P = {}", p.display());
    println!("Q = {}", q.display());
    println!("R = {}", r.display());

    // Modus Ponens: P ∧ (P→Q) → Q
    let p_implies_q = p.implication(q);
    println!("P → Q = {}", p_implies_q.display());
    let mp_result = p.modus_ponens(&p_implies_q);
    println!("Modus Ponens result: {}", mp_result.display());

    // Modus Tollens: ¬Q ∧ (P→Q) → ¬P
    let not_q = q.negation();
    println!("¬Q = {}", not_q.display());
    let mt_result = p.modus_tollens(&not_q);
    println!("Modus Tollens result: {}", mt_result.display());

    // Proof by Contradiction: P ∧ ¬P → Q (ex falso quodlibet)
    let contradiction = p.conjunction(&p.negation());
    println!("Contradiction (P ∧ ¬P): {}", contradiction.display());
    let cp_result = contradiction.proof_by_contradiction();
    println!("Proof by Contradiction result: {}", cp_result.display());

    // 6. Demonstrate random exploration
    println!("\n=== Random Exploration ===");

    let mut session = ExplorationSession::new(42);
    let results = session.explore(10);

    for (i, (obj, prop)) in results.iter().enumerate() {
        println!("Step {}: Object={}, Proposition={}", i + 1, obj.display(), prop.display());
    }

    println!("\nExploration stats: {} objects, {} propositions", session.stats().0, session.stats().1);

    // 7. Demonstrate quality evaluation
    println!("\n=== Quality Evaluation ===");

    let empty_set = Object::Set(SetType::Constant, vec![]);
    let non_empty_set = Object::Set(SetType::Constant, vec![Object::Int(1), Object::Int(2)]);

    for (i, q) in get_qualities().iter().enumerate() {
        println!("Quality {}: {}", i + 1, q.name);
        println!("  Empty set: {}", empty_set.display());
        println!("  Non-empty set: {}", non_empty_set.display());
    }

    println!("\n=== Prometheus Framework Initialized ===");
}
