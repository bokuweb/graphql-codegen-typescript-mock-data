import { parse, printSchema } from 'graphql';
import casual from 'casual';
import { oldVisit } from '@graphql-codegen/plugin-helpers';
import { pascalCase } from 'pascal-case';
import { upperCase } from 'upper-case';
import { sentenceCase } from 'sentence-case';
import a from 'indefinite';
const convertName = (value, fn, transformUnderscore) => {
    if (transformUnderscore) {
        return fn(value);
    }
    return value
        .split('_')
        .map((s) => fn(s))
        .join('_');
};
const createNameConverter = (convention, transformUnderscore) => (value, prefix = '') => {
    switch (convention) {
        case 'upper-case#upperCase': {
            return `${prefix}${convertName(value, (s) => upperCase(s || ''), transformUnderscore)}`;
        }
        case 'keep':
            return `${prefix}${value}`;
        case 'pascal-case#pascalCase':
        // fallthrough
        default:
            // default to pascal case in case of unknown values
            return `${prefix}${convertName(value, (s) => pascalCase(s || ''), transformUnderscore)}`;
    }
};
const toMockName = (typedName, casedName, prefix) => {
    if (prefix) {
        return `${prefix}${casedName}`;
    }
    const firstWord = sentenceCase(typedName).split(' ')[0];
    return `${a(firstWord, { articleOnly: true })}${casedName}`;
};
const updateTextCase = (str, enumValuesConvention, transformUnderscore) => {
    const convert = createNameConverter(enumValuesConvention, transformUnderscore);
    if (str.charAt(0) === '_') {
        return str.replace(/^(_*)(.*)/, (_match, underscorePrefix, typeName) => `${underscorePrefix}${convert(typeName)}`);
    }
    return convert(str);
};
const hashedString = (value) => {
    let hash = 0;
    if (value.length === 0) {
        return hash;
    }
    for (let i = 0; i < value.length; i++) {
        const char = value.charCodeAt(i);
        // eslint-disable-next-line no-bitwise
        hash = (hash << 5) - hash + char;
        // eslint-disable-next-line no-bitwise
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
};
const getScalarDefinition = (value) => {
    if (typeof value === 'string') {
        return {
            generator: value,
            arguments: [],
        };
    }
    return value;
};
const getNamedType = (opts) => {
    if (!opts.currentType) {
        return '';
    }
    casual.seed(hashedString(opts.typeName + opts.fieldName));
    const name = opts.currentType.name.value;
    const casedName = createNameConverter(opts.typenamesConvention, opts.transformUnderscore)(name);
    switch (name) {
        case 'String':
            return `'${casual.word}'`;
        case 'Float':
            return Math.round(casual.double(0, 10) * 100) / 100;
        case 'ID':
            return `'${casual.uuid}'`;
        case 'Boolean':
            return casual.boolean;
        case 'Int':
            return casual.integer(0, 9999);
        default: {
            const foundType = opts.types.find((enumType) => enumType.name === name);
            if (foundType) {
                switch (foundType.type) {
                    case 'enum': {
                        // It's an enum
                        const typenameConverter = createNameConverter(opts.typenamesConvention, opts.transformUnderscore);
                        const value = foundType.values ? foundType.values[0] : '';
                        return `${typenameConverter(foundType.name, opts.enumsPrefix)}.${updateTextCase(value, opts.enumValuesConvention, opts.transformUnderscore)}`;
                    }
                    case 'union':
                        // Return the first union type node.
                        return getNamedType({
                            ...opts,
                            currentType: foundType.types && foundType.types[0],
                        });
                    case 'scalar': {
                        const customScalar = opts.customScalars
                            ? getScalarDefinition(opts.customScalars[foundType.name])
                            : null;
                        // it's a scalar, let's use a string as a value if there is no custom
                        // mapping for this particular scalar
                        if (!customScalar || !customScalar.generator) {
                            if (foundType.name === 'Date') {
                                return `'${new Date(casual.unix_time).toISOString()}'`;
                            }
                            return `'${casual.word}'`;
                        }
                        // If there is a mapping to a `casual` type, then use it and make sure
                        // to call it if it's a function
                        const embeddedGenerator = casual[customScalar.generator];
                        if (!embeddedGenerator && customScalar.generator) {
                            return customScalar.generator;
                        }
                        const generatorArgs = Array.isArray(customScalar.arguments)
                            ? customScalar.arguments
                            : [customScalar.arguments];
                        const value = typeof embeddedGenerator === 'function'
                            ? embeddedGenerator(...generatorArgs)
                            : embeddedGenerator;
                        if (typeof value === 'string') {
                            return `'${value}'`;
                        }
                        if (typeof value === 'object') {
                            return `${JSON.stringify(value)}`;
                        }
                        return value;
                    }
                    default:
                        throw `foundType is unknown: ${foundType.name}: ${foundType.type}`;
                }
            }
            if (opts.terminateCircularRelationships) {
                return `relationshipsToOmit.has('${name}') ? {} as ${name} : ${toMockName(name, casedName, opts.prefix)}({}, relationshipsToOmit)`;
            }
            else {
                return `${toMockName(name, casedName, opts.prefix)}()`;
            }
        }
    }
};
const generateMockValue = (opts) => {
    switch (opts.currentType.kind) {
        case 'NamedType':
            return getNamedType({
                ...opts,
                currentType: opts.currentType,
            });
        case 'NonNullType':
            return generateMockValue({
                ...opts,
                currentType: opts.currentType.type,
            });
        case 'ListType': {
            const value = generateMockValue({
                ...opts,
                currentType: opts.currentType.type,
            });
            return `[${value}]`;
        }
        default:
            throw new Error('unreached');
    }
};
const getMockString = (typeName, fields, typenamesConvention, terminateCircularRelationships, addTypename = false, prefix, typesPrefix = '', transformUnderscore) => {
    const typenameConverter = createNameConverter(typenamesConvention, transformUnderscore);
    const casedName = typenameConverter(typeName);
    const casedNameWithPrefix = typenameConverter(typeName, typesPrefix);
    const typename = addTypename ? `\n        __typename: '${typeName}',` : '';
    const typenameReturnType = addTypename ? `{ __typename: '${typeName}' } & ` : '';
    if (terminateCircularRelationships) {
        return `
export const ${toMockName(typeName, casedName, prefix)} = (overrides?: Partial<${casedNameWithPrefix}>, relationshipsToOmit: Set<string> = new Set()): ${typenameReturnType}${casedNameWithPrefix} => {
    relationshipsToOmit.add('${casedName}');
    return {${typename}
${fields}
    };
};`;
    }
    else {
        return `
export const ${toMockName(typeName, casedName, prefix)} = (overrides?: Partial<${casedNameWithPrefix}>): ${typenameReturnType}${casedNameWithPrefix} => {
    return {${typename}
${fields}
    };
};`;
    }
};
const getImportTypes = ({ typenamesConvention, definitions, types, typesFile, typesPrefix, enumsPrefix, transformUnderscore, }) => {
    const typenameConverter = createNameConverter(typenamesConvention, transformUnderscore);
    const typeImports = (typesPrefix === null || typesPrefix === void 0 ? void 0 : typesPrefix.endsWith('.'))
        ? [typesPrefix.slice(0, -1)]
        : definitions
            .filter(({ typeName }) => !!typeName)
            .map(({ typeName }) => typenameConverter(typeName, typesPrefix));
    const enumTypes = (enumsPrefix === null || enumsPrefix === void 0 ? void 0 : enumsPrefix.endsWith('.'))
        ? [enumsPrefix.slice(0, -1)]
        : types.filter(({ type }) => type === 'enum').map(({ name }) => typenameConverter(name, enumsPrefix));
    typeImports.push(...enumTypes);
    function onlyUnique(value, index, self) {
        return self.indexOf(value) === index;
    }
    return typesFile ? `import { ${typeImports.filter(onlyUnique).join(', ')} } from '${typesFile}';\n` : '';
};
// This plugin was generated with the help of ast explorer.
// https://astexplorer.net
// Paste your graphql schema in it, and you'll be able to see what the `astNode` will look like
export const plugin = (schema, documents, config) => {
    var _a;
    const printedSchema = printSchema(schema); // Returns a string representation of the schema
    const astNode = parse(printedSchema); // Transforms the string into ASTNode
    const enumValuesConvention = config.enumValues || 'pascal-case#pascalCase';
    const typenamesConvention = config.typenames || 'pascal-case#pascalCase';
    const transformUnderscore = (_a = config.transformUnderscore) !== null && _a !== void 0 ? _a : true;
    // List of types that are enums
    const types = [];
    const visitor = {
        EnumTypeDefinition: (node) => {
            const name = node.name.value;
            if (!types.find((enumType) => enumType.name === name)) {
                types.push({
                    name,
                    type: 'enum',
                    values: node.values ? node.values.map((node) => node.name.value) : [],
                });
            }
        },
        UnionTypeDefinition: (node) => {
            const name = node.name.value;
            if (!types.find((enumType) => enumType.name === name)) {
                types.push({
                    name,
                    type: 'union',
                    types: node.types,
                });
            }
        },
        FieldDefinition: (node) => {
            const fieldName = node.name.value;
            return {
                name: fieldName,
                mockFn: (typeName) => {
                    const value = generateMockValue({
                        typeName,
                        fieldName,
                        types,
                        typenamesConvention,
                        enumValuesConvention,
                        terminateCircularRelationships: !!config.terminateCircularRelationships,
                        prefix: config.prefix,
                        typesPrefix: config.typesPrefix,
                        enumsPrefix: config.enumsPrefix,
                        currentType: node.type,
                        customScalars: config.scalars,
                        transformUnderscore,
                    });
                    return `        ${fieldName}: overrides && overrides.hasOwnProperty('${fieldName}') ? overrides.${fieldName}! : ${value},`;
                },
            };
        },
        InputObjectTypeDefinition: (node) => {
            const fieldName = node.name.value;
            return {
                typeName: fieldName,
                mockFn: () => {
                    const mockFields = node.fields
                        ? node.fields
                            .map((field) => {
                            const value = generateMockValue({
                                typeName: fieldName,
                                fieldName: field.name.value,
                                types,
                                typenamesConvention,
                                enumValuesConvention,
                                terminateCircularRelationships: !!config.terminateCircularRelationships,
                                prefix: config.prefix,
                                typesPrefix: config.typesPrefix,
                                enumsPrefix: config.enumsPrefix,
                                currentType: field.type,
                                customScalars: config.scalars,
                                transformUnderscore,
                            });
                            return `        ${field.name.value}: overrides && overrides.hasOwnProperty('${field.name.value}') ? overrides.${field.name.value}! : ${value},`;
                        })
                            .join('\n')
                        : '';
                    return getMockString(fieldName, mockFields, typenamesConvention, !!config.terminateCircularRelationships, false, config.prefix, config.typesPrefix, transformUnderscore);
                },
            };
        },
        ObjectTypeDefinition: (node) => {
            // This function triggered per each type
            const typeName = node.name.value;
            const { fields } = node;
            return {
                typeName,
                mockFn: () => {
                    const mockFields = fields ? fields.map(({ mockFn }) => mockFn(typeName)).join('\n') : '';
                    return getMockString(typeName, mockFields, typenamesConvention, !!config.terminateCircularRelationships, !!config.addTypename, config.prefix, config.typesPrefix, transformUnderscore);
                },
            };
        },
        InterfaceTypeDefinition: (node) => {
            const typeName = node.name.value;
            const { fields } = node;
            return {
                typeName,
                mockFn: () => {
                    const mockFields = fields ? fields.map(({ mockFn }) => mockFn(typeName)).join('\n') : '';
                    return getMockString(typeName, mockFields, typenamesConvention, !!config.terminateCircularRelationships, !!config.addTypename, config.prefix, config.typesPrefix, transformUnderscore);
                },
            };
        },
        ScalarTypeDefinition: (node) => {
            const name = node.name.value;
            if (!types.find((enumType) => enumType.name === name)) {
                types.push({
                    name,
                    type: 'scalar',
                });
            }
        },
    };
    const result = oldVisit(astNode, { leave: visitor });
    const definitions = result.definitions.filter((definition) => !!definition);
    const typesFile = config.typesFile ? config.typesFile.replace(/\.[\w]+$/, '') : null;
    const typesFileImport = getImportTypes({
        typenamesConvention,
        definitions,
        types,
        typesFile,
        typesPrefix: config.typesPrefix,
        enumsPrefix: config.enumsPrefix,
        transformUnderscore: transformUnderscore,
    });
    // List of function that will generate the mock.
    // We generate it after having visited because we need to distinct types from enums
    const mockFns = definitions
        .map(({ mockFn }) => mockFn)
        .filter((mockFn) => !!mockFn);
    return `${typesFileImport}${mockFns.map((mockFn) => mockFn()).join('\n')}
`;
};
//# sourceMappingURL=index.js.map