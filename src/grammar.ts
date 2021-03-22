import { SourceLocation } from "./ir";
import { ErrorElement, IdenToken, KeywordToken, NumberLiteralToken, OperatorToken, PUNCTUATION, PunctuationToken, StringLiteralToken, Token, tokenize, TypeIdenToken, TypeKeywordToken, TypeVarToken } from "./lexer";
import { RecordParserDescription, ConstParser, Parser, ParsersFor, RecordParser, RepeatParser, TokenParser, DebugContext, ParseResult, choice, ChoiceParser, TokenSpan, FailHandler } from "./parser";

function keywordParser<K extends KeywordToken["keyword"]>(keyword: K): Parser<Token, KeywordToken> {
	return new TokenParser((t) => {
		if (t.tag === "keyword") {
			if (t.keyword === keyword) {
				return t;
			}
		}
		return null;
	});
}

function tokenParser<T extends Token["tag"]>(tag: T): Parser<Token, Extract<Token, { tag: T }>> {
	return new TokenParser((t: Token) => {
		if (t.tag === tag) {
			return t as Extract<Token, { tag: T }>;
		}
		return null;
	});
}

function punctuationParser<K extends keyof typeof PUNCTUATION>(symbol: K): Parser<Token, PunctuationToken> {
	return new TokenParser((t: Token) => {
		if (t.tag === "punctuation" && t.symbol === symbol) {
			return t;
		}
		return null;
	});
}


const eofParser: Parser<Token, SourceLocation> = new TokenParser(t => t.tag === "eof" ? t.location : null);

/// `CommaParser` is a combinator that parses a comma-separated sequence of 
/// elements.
class CommaParser<T> extends Parser<Token, T[]> {
	constructor(
		private element: Parser<Token, T>,
		private expected: string,
		private min = 0) {
		super();
	}

	parse(stream: Token[], from: number, debugContext: Record<string, TokenSpan<Token>>): ParseResult<T[]> {
		let out = [];
		while (true) {
			const object = this.element.parse(stream, from, debugContext);
			if (object === null) {
				if (out.length < this.min) {
					return null;
				} else if (out.length === 0) {
					return { object: [], rest: from };
				}
				throw new ParseError([this.expected, stream[from].location]);
			} else {
				out.push(object.object);
				from = object.rest;
			}

			// Parse a comma.
			const comma = punctuation.comma.parse(stream, from, debugContext);
			if (comma === null) {
				if (out.length < this.min) {
					return null;
				}
				return {
					object: out,
					rest: from,
				};
			} else {
				from = comma.rest;
			}
		}
	}
}

class StructParser<T extends { location: SourceLocation }, R> extends Parser<T, R & { location: SourceLocation }> {
	parser: RecordParser<T, R>;

	constructor(spec: () => RecordParserDescription<T, R>) {
		super();
		this.parser = new RecordParser(spec);
	}

	parse(stream: T[], from: number, debugContext: DebugContext<T>): ParseResult<R & { location: SourceLocation }> {
		const firstToken = stream[from].location;

		const result = this.parser.parse(stream, from, debugContext);
		if (result === null || "message" in result) {
			return result;
		}

		const lastToken = stream[result.rest - 1].location;
		const location = {
			fileID: firstToken.fileID,
			offset: firstToken.offset,
			length: lastToken.offset + lastToken.length - firstToken.offset,
		};

		return {
			object: { ...result.object, location },
			rest: result.rest,
		};
	}
}

function requireAtLeastOne<T>(thing: string) {
	return (array: T[], tokens: Token[], from: number) => {
		if (array.length === 0) {
			throw new ParseError([
				"Expected at least one " + thing + " at",
				tokens[from].location,
			]);
		}
		return array;
	};
}

function parseProblem(...message: (ErrorElement | FailHandler<Token, ErrorElement | ErrorElement[]>)[]) {
	return (stream: Token[], from: number, context: DebugContext<Token>) => {
		const out = [];
		for (let e of message) {
			if (typeof e === "function") {
				const x = e(stream, from, context);
				if (Array.isArray(x)) {
					out.push(...x);
				} else {
					out.push(x);
				}
			} else {
				out.push(e);
			}
		}
		return new ParseError(out);
	};
}

export class ParseError {
	constructor(public message: ErrorElement[]) { }

	toString() {
		return JSON.stringify(this.message);
	}
}

function atReference(name: string) {
	return (stream: Token[], from: number, props: DebugContext<Token>): SourceLocation => {
		const token = props[name].first;
		if (token === null) {
			throw new Error("null first in atReference");
		} else {
			return token.location;
		}
	}
}

function atHead(stream: Token[], from: number): SourceLocation {
	const token = stream[from];
	if (token === undefined) {
		throw new Error("out of bounds");
	} else {
		return token.location;
	}
}

/// THROWS `LexError`
/// THROWS `ParseError`
export function parseSource(blob: string, fileID: string) {
	const tokens = tokenize(blob, fileID);
	const result = grammar.Source.parse(tokens, 0, {})!;
	// N.B.: The end-of parser in Source ensures no tokens are left afterwards.
	return result.object;
}

export type BooleanLiteralToken = KeywordToken & { keyword: "true" | "false" };

const tokens = {
	packageIden: tokenParser("iden"),
	typeIden: tokenParser("type-iden"),
	iden: tokenParser("iden"),
	typeVarIden: tokenParser("type-var"),
	typeKeyword: tokenParser("type-keyword"),
	operator: tokenParser("operator"),
	stringLiteral: tokenParser("string-literal"),
	numberLiteral: tokenParser("number-literal"),
	booleanLiteral: new TokenParser((token: Token) => {
		if (token.tag !== "keyword") {
			return null;
		} else if (token.keyword !== "true" && token.keyword !== "false") {
			return null;
		}
		return token as BooleanLiteralToken;
	}),
};

const keywords = {
	class: keywordParser("class"),
	else: keywordParser("else"),
	fn: keywordParser("fn"),
	if: keywordParser("if"),
	import: keywordParser("import"),
	is: keywordParser("is"),
	interface: keywordParser("interface"),
	package: keywordParser("package"),
	proof: keywordParser("proof"),
	record: keywordParser("record"),
	return: keywordParser("return"),
	var: keywordParser("var"),
};

const punctuation = {
	semicolon: punctuationParser(";"),
	comma: punctuationParser(","),
	colon: punctuationParser(":"),
	dot: punctuationParser("."),
	equal: punctuationParser("="),
	pipe: punctuationParser("|"),
	curlyOpen: punctuationParser("{"),
	curlyClose: punctuationParser("}"),
	roundOpen: punctuationParser("("),
	roundClose: punctuationParser(")"),
	squareOpen: punctuationParser("["),
	squareClose: punctuationParser("]"),
};

export interface Source {
	package: PackageDef,
	imports: Import[],
	definitions: Definition[],
}

export interface PackageDef {
	packageName: IdenToken,
}

export interface ImportOfObject {
	tag: "of-object",

	packageName: IdenToken,
	objectName: TypeIdenToken,

	location: SourceLocation,
}

export interface ImportOfPackage {
	tag: "of-package",

	packageName: IdenToken,

	location: SourceLocation,
}

export interface Import {
	imported: ImportOfObject | ImportOfPackage,
}

export type Definition = RecordDefinition;

export interface RecordDefinition {
	tag: "record-definition",
	entityName: TypeIdenToken,
	typeParameters: TypeParameters,
	fields: Field[],
	fns: Fn[],

	location: SourceLocation,
}

export interface InterfaceMember {
	signature: FnSignature,
}

export interface InterfaceDefinition {
	tag: "interface-definition",
	entityName: TypeIdenToken,
	typeParameters: TypeParameters,
	members: InterfaceMember[],
}

export interface Field {
	name: IdenToken,
	t: Type,
}

export interface FnParameters {
	parameters: FnParameter[],
}

export interface FnParameter {
	name: IdenToken,
	t: Type,
}

export interface FnSignature {
	proof: KeywordToken | false,
	name: IdenToken,
	parameters: FnParameter[],
	returns: Type[],
}

export interface Fn {
	signature: FnSignature,
	body: Block,
}

// For bringing new type variables into a scope.
interface TypeParameters {
	parameters: TypeVarToken[],
	constraints: TypeConstraint[],
}

// For specifying arguments to some entity.
interface TypeArguments {
	arguments: Type[],
}

interface TypeConstraint {
	subject: TypeVarToken,
	constraint: Type,
}

interface TypeConstraints {
	constraints: TypeConstraint[],
}

export interface TypeNamed {
	tag: "named",
	packageQualification: PackageQualification | null,
	entity: TypeIdenToken,
	arguments: Type[],
	location: SourceLocation,
}

export interface PackageQualification {
	package: IdenToken,

	location: SourceLocation,
}

export type Type = TypeNamed | TypeKeywordToken;

export interface Block {
	statements: Statement[],
}

export interface ReturnSt {
	tag: "return",
	values: Expression[],

	location: SourceLocation,
}

export interface IfSt {
	tag: "if",
	condition: Expression,
	body: Block,
	elseIfClauses: ElseIfClause[],
	elseClause: ElseClause | null,
}

export interface ElseIfClause {
	condition: Expression,
	body: Block,
}

export interface ElseClause {
	body: Block,
}

export type Statement = VarSt | ReturnSt | IfSt;

export interface VarSt {
	tag: "var",
	variables: VarDecl[],
	initialization: Expression[],

	location: SourceLocation,
}

export interface VarDecl {
	variable: IdenToken,
	t: Type,

	location: SourceLocation,
}

export interface Expression {
	left: ExpressionOperand,
	operations: ExpressionOperation[],

	location: SourceLocation,
}

export type ExpressionAccess = ExpressionAccessMethod | ExpressionAccessField;

export interface ExpressionAccessMethod {
	tag: "method",
	methodName: IdenToken,
	args: Expression[],
}

export interface ExpressionAccessField {
	tag: "field",
	fieldName: IdenToken,
}

export interface ExpressionOperand {
	atom: ExpressionAtom,
	accesses: ExpressionAccess[],

	location: SourceLocation,
}

export type BinaryLogicalToken = KeywordToken & { keyword: "and" | "or" | "implies" };

export interface LogicalOperation {
	operator: BinaryLogicalToken,
	right: ExpressionOperand,
}

export type ExpressionOperation = ExpressionOperationBinary;

export interface ExpressionOperationBinary {
	operator: OperatorToken,
	right: ExpressionOperand,
}

export interface ExpressionParenthesized {
	tag: "paren",
	expression: Expression,

	location: SourceLocation,
}

export interface ExpressionCall {
	tag: "call",
	t: Type,
	methodName: IdenToken,
	arguments: Expression[],

	location: SourceLocation,
}

export interface ExpressionNew {
	tag: "new",
	args: ExpressionNewArg[],
}

export interface ExpressionNewArg {
	fieldName: IdenToken,
	value: Expression,
}

export type ExpressionAtom = ExpressionParenthesized
	| StringLiteralToken | NumberLiteralToken
	| BooleanLiteralToken
	| IdenToken
	| ExpressionCall
	| ExpressionNew;

type ASTs = {
	Block: Block,
	Definition: Definition,
	ElseClause: ElseClause,
	ElseIfClause: ElseIfClause,
	Expression: Expression,
	ExpressionAccess: ExpressionAccess,
	ExpressionAccessField: ExpressionAccessField,
	ExpressionAccessMethod: ExpressionAccessMethod,
	ExpressionAtom: ExpressionAtom,
	ExpressionCall: ExpressionCall,
	ExpressionOperand: ExpressionOperand,
	ExpressionOperation: ExpressionOperation,
	ExpressionOperationBinary: ExpressionOperationBinary,
	ExpressionParenthesized: ExpressionParenthesized,
	Field: Field,
	Fn: Fn,
	FnParameter: FnParameter,
	FnParameters: FnParameters,
	FnSignature: FnSignature,
	IfSt: IfSt,
	Import: Import,
	ImportOfObject: ImportOfObject,
	ImportOfPackage: ImportOfPackage,
	InterfaceDefinition: InterfaceDefinition,
	InterfaceMember: InterfaceMember,
	PackageDef: PackageDef,
	PackageQualification: PackageQualification,
	RecordDefinition: RecordDefinition,
	ReturnSt: ReturnSt,
	Source: Source,
	Statement: Statement,
	Type: Type,
	TypeArguments: TypeArguments,
	TypeNamed: TypeNamed,
	TypeParameterConstraint: TypeConstraint,
	TypeParameterConstraints: TypeConstraints,
	TypeParameters: TypeParameters,
	VarDecl: VarDecl,
	VarSt: VarSt,
};

export const grammar: ParsersFor<Token, ASTs> = {
	Block: new RecordParser(() => ({
		_open: punctuation.curlyOpen,
		statements: new RepeatParser(grammar.Statement),
		_close: punctuation.curlyClose
			.required(parseProblem(
				"Expected a `}` at", atHead,
				"to complete a block started at", atReference("_open"))),
	})),
	TypeNamed: new StructParser(() => ({
		packageQualification: grammar.PackageQualification
			.otherwise(null),
		entity: tokens.typeIden,
		tag: new ConstParser("named"),
		arguments: grammar.TypeArguments.map(x => x.arguments).otherwise([]),
	})),
	Definition: new ChoiceParser(() => [grammar.RecordDefinition]),
	ElseClause: new RecordParser(() => ({
		_else: keywords.else,
		body: grammar.Block
			.required(parseProblem("Expected a block after `else` at", atHead)),
	})),
	ElseIfClause: new RecordParser(() => ({
		_else: keywords.else,
		_if: keywords.if,
		condition: grammar.Expression
			.required(parseProblem("Expected an expression after `if` at", atHead)),
		body: grammar.Block
			.required(parseProblem("Expected a block after condition at", atHead)),
	})),
	Expression: new StructParser(() => ({
		left: grammar.ExpressionOperand,
		operations: new RepeatParser(grammar.ExpressionOperation),
	})),
	ExpressionAccess: choice(() => grammar, "ExpressionAccessMethod", "ExpressionAccessField"),
	ExpressionAccessField: new StructParser(() => ({
		_dot: punctuation.dot,
		fieldName: tokens.iden,
		tag: new ConstParser("field"),
	})),
	ExpressionAccessMethod: new StructParser(() => ({
		_dot: punctuation.dot,
		methodName: tokens.iden
			.required(parseProblem("Expected a field or method name after a `.` at", atHead)),
		_open: punctuation.roundOpen,
		tag: new ConstParser("method"),
		args: new CommaParser(grammar.Expression,
			"Expected another method argument at"),
		_close: punctuation.roundClose
			.required(parseProblem("Expected a `)` at", atHead,
				"to complete a method call beginning at", atReference("_open"))),
	})),
	ExpressionAtom: new ChoiceParser<Token, ExpressionAtom>(() => [
		grammar.ExpressionParenthesized,
		tokens.stringLiteral,
		tokens.numberLiteral,
		tokens.booleanLiteral,
		tokens.iden,
		grammar.ExpressionCall,
	]),
	ExpressionCall: new StructParser(() => ({
		t: grammar.TypeNamed,
		tag: new ConstParser("call"),
		_dot: punctuation.dot
			.required(parseProblem(
				"Expected a `.` after a type in a function call expression at", atHead)),
		methodName: tokens.iden
			.required(parseProblem(
				"Expected a function name after `.` in a call expression", atHead)),
		_open: punctuation.roundOpen
			.required(parseProblem(
				"Expected a `(` after a function name in a call expression at", atHead)),
		arguments: new CommaParser(grammar.Expression, "Expected another argument at"),
		_close: punctuation.roundClose
			.required(parseProblem(
				"Expected a `)` at", atHead,
				"to complete a function call beginning at", atReference("_open"))),
	})),
	ExpressionOperand: new StructParser(() => ({
		atom: grammar.ExpressionAtom,
		accesses: new RepeatParser(grammar.ExpressionAccess),
	})),
	ExpressionOperation: choice(() => grammar, "ExpressionOperationBinary"),
	ExpressionOperationBinary: new RecordParser(() => ({
		operator: tokens.operator,
		right: grammar.ExpressionOperand
			.required(parseProblem("Expected an operand at", atHead,
				"after the binary operator at", atReference("operator")))
	})),
	ExpressionParenthesized: new StructParser(() => ({
		_open: punctuation.roundOpen,
		tag: new ConstParser("paren"),
		expression: grammar.Expression,
		_close: punctuation.roundClose
			.required(parseProblem("Expected a `)` at", atHead,
				"to complete a grouping that began at", atReference("_open"))),
	})),
	Field: new StructParser(() => ({
		_var: keywords.var,
		name: tokens.iden
			.required(parseProblem("Expected a field name after `var` at", atHead)),
		_colon: punctuation.colon
			.required(parseProblem("Expected a `;` after variable name at", atHead)),
		t: grammar.Type
			.required(parseProblem("Expected a type after `:` at", atHead)),
		_semicolon: punctuation.semicolon
			.required(parseProblem("Expected a `;` after field type at", atHead)),
	})),
	Fn: new RecordParser(() => ({
		signature: grammar.FnSignature,
		body: grammar.Block
			.required(parseProblem("Expected a `{` to begin a function body at", atHead))
	})),
	FnParameter: new RecordParser(() => ({
		name: tokens.iden,
		_colon: punctuation.colon,
		t: grammar.Type,
	})),
	FnParameters: new RecordParser(() => ({
		_open: punctuation.roundOpen,
		parameters: new CommaParser(grammar.FnParameter,
			"Expected another function parameter after `,` at"),
		_close: punctuation.roundClose
			.required(parseProblem("Expected a `)` at", atHead,
				"to complete the parameter list started at", atReference("_open"))),
	})),
	FnSignature: new StructParser(() => ({
		proof: keywords.proof.otherwise(false as const),
		_fn: keywords.fn,
		name: tokens.iden
			.required(parseProblem("Expected a function name after `fn` at", atHead)),
		parameters: grammar.FnParameters.map(x => x.parameters)
			.required(parseProblem("Expected a `(` to begin function parameters at", atHead)),
		_colon: punctuation.colon
			.required(parseProblem("Expected a `:` after function parameters at", atHead)),
		returns: new CommaParser(grammar.Type, "Expected a return type at")
			.map(requireAtLeastOne("return type")),
	})),
	IfSt: new RecordParser(() => ({
		_if: keywords.if,
		tag: new ConstParser("if"),
		condition: grammar.Expression
			.required(parseProblem("Expected a condition after `if` at", atHead)),
		body: grammar.Block
			.required(parseProblem("Expected a block after if condition at", atHead)),
		elseIfClauses: new RepeatParser(grammar.ElseIfClause),
		elseClause: grammar.ElseClause.otherwise(null),
	})),
	InterfaceMember: new RecordParser(() => ({
		signature: grammar.FnSignature,
		_semicolon: punctuation.semicolon
			.required(parseProblem("Expected a `;` to complete the interface member at", atHead)),
	})),
	InterfaceDefinition: new RecordParser(() => ({
		_interface: keywords.interface,
		tag: new ConstParser("interface-definition"),
		entityName: tokens.typeIden,
		typeParameters: grammar.TypeParameters
			.otherwise({ parameters: [], constraints: [] } as TypeParameters),
		_open: punctuation.curlyOpen,
		members: new RepeatParser(grammar.InterfaceMember),
		_close: punctuation.curlyClose
			.required(parseProblem("Expected a `}` at", atHead,
				"to complete an interface definition beginning at", atReference("_open"))),
	})),
	Import: new RecordParser(() => ({
		_import: keywords.import,
		imported: choice(() => grammar, "ImportOfObject", "ImportOfPackage")
			.required(parseProblem("Expected an entity or package to import after `import` at", atHead)),
		_semicolon: punctuation.semicolon
			.required(parseProblem("Expected a `;` to end the import at", atHead)),
	})),
	ImportOfObject: new StructParser(() => ({
		tag: new ConstParser("of-object"),
		packageName: tokens.packageIden,
		_dot: punctuation.dot,
		objectName: tokens.typeIden
			.required(parseProblem("Expected an object name to import after `:` at", atHead)),
	})),
	ImportOfPackage: new StructParser(() => ({
		tag: new ConstParser("of-package"),
		packageName: tokens.packageIden,
	})),
	PackageDef: new RecordParser(() => ({
		_package: keywords.package,
		packageName: tokens.packageIden
			.required(parseProblem("Expected a package name after `package` at", atHead)),
		_semicolon: punctuation.semicolon
			.required(parseProblem("Expected a `;` to end the package declaration at", atHead)),
	})),
	Source: new RecordParser(() => ({
		package: grammar.PackageDef
			.required(parseProblem("Expected a package declaration to begin the source file at", atHead)),
		imports: new RepeatParser(grammar.Import),
		definitions: new RepeatParser(grammar.Definition),
		_eof: eofParser
			.required(parseProblem("Expected another definition at", atHead)),
	})),
	PackageQualification: new StructParser(() => ({
		package: tokens.iden,
		_dot: punctuation.dot
			.required(parseProblem("Expected a `.` after a package name at", atHead)),
	})),
	RecordDefinition: new StructParser(() => ({
		_record: keywords.record,
		tag: new ConstParser("record-definition"),
		entityName: tokens.typeIden,
		typeParameters: grammar.TypeParameters
			.otherwise({ parameters: [], constraints: [] } as TypeParameters),
		_open: punctuation.curlyOpen,
		fields: new RepeatParser(grammar.Field),
		fns: new RepeatParser(grammar.Fn),
		_close: punctuation.curlyClose
			.required(parseProblem("Expected a `}` at", atHead,
				"to complete a record definition beginning at", atReference("_open"))),
	})),
	ReturnSt: new StructParser(() => ({
		_return: keywords.return,
		tag: new ConstParser("return"),
		values: new CommaParser(grammar.Expression, "Expected an expression at"),
		_semicolon: punctuation.semicolon
			.required(parseProblem("Expected a `;` to complete a return statement at", atHead)),
	})),
	Statement: choice(() => grammar, "VarSt", "ReturnSt", "IfSt"),
	Type: new ChoiceParser<Token, Type>(() => [grammar.TypeNamed, tokens.typeKeyword]),
	TypeArguments: new RecordParser(() => ({
		_open: punctuation.squareOpen,
		arguments: new CommaParser(grammar.Type, "Expected a type argument at")
			.map(requireAtLeastOne("type argument")),
		_close: punctuation.squareClose
			.required(parseProblem("Expected a `]` at", atHead,
				"to complete type arguments started at", atReference("_open"))),
	})),
	TypeParameterConstraint: new RecordParser(() => ({
		subject: tokens.typeVarIden,
		_is: keywords.is
			.required(parseProblem("Expected `is` after type constraint subject at", atHead)),
		constraint: grammar.Type
			.required(parseProblem("Expected a constraint to be named after `is` at", atHead)),
	})),
	TypeParameterConstraints: new RecordParser(() => ({
		_pipe: punctuation.pipe,
		constraints: new CommaParser(grammar.TypeParameterConstraint,
			"Expected a type constraint at", 1)
			.required(parseProblem("Expected at least one type constraint at", atHead)),
	})),
	TypeParameters: new RecordParser(() => ({
		_open: punctuation.squareOpen,
		parameters: new CommaParser(tokens.typeVarIden, "Expected a type variable at", 1)
			.required(parseProblem("Expected a type variable at", atHead)),
		constraints: grammar.TypeParameterConstraints.map(x => x.constraints),
		_close: punctuation.squareClose
			.required(parseProblem("Expected a `]` at", atHead,
				"to complete type parameters started at", atReference("_open"))),
	})),
	VarSt: new StructParser(() => ({
		variables: new CommaParser(grammar.VarDecl, "variable declaration", 1),
		tag: new ConstParser("var"),
		"_eq": punctuation.equal
			.required(parseProblem("Expected a `=` after variable declarations at", atHead)),
		initialization: new CommaParser(grammar.Expression, "expression", 1),
		"_semicolon": punctuation.semicolon
			.required(parseProblem("Expected a `;` after variable initialization at", atHead)),
	})),
	VarDecl: new StructParser(() => ({
		_var: keywordParser("var"),
		variable: tokens.iden
			.required(parseProblem("Expected a variable name after `var` in a variable declaration at", atHead)),
		_colon: punctuation.colon
			.required(parseProblem("Expected a `:` after a variable name in a variable declaration at", atHead)),
		t: grammar.Type
			.required(parseProblem("Expected a type after `:` in a variable declaration at", atHead)),
	})),
};
