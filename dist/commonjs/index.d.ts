import { PluginFunction } from '@graphql-codegen/plugin-helpers';
declare type NamingConvention = 'upper-case#upperCase' | 'pascal-case#pascalCase' | 'keep';
declare type ScalarGeneratorName = keyof Casual.Casual | keyof Casual.functions | string;
declare type ScalarDefinition = {
    generator: ScalarGeneratorName;
    arguments: unknown;
};
declare type ScalarMap = {
    [name: string]: ScalarGeneratorName | ScalarDefinition;
};
export interface TypescriptMocksPluginConfig {
    typesFile?: string;
    enumValues?: NamingConvention;
    typenames?: NamingConvention;
    addTypename?: boolean;
    prefix?: string;
    scalars?: ScalarMap;
    terminateCircularRelationships?: boolean;
    typesPrefix?: string;
    enumsPrefix?: string;
    transformUnderscore?: boolean;
}
export declare const plugin: PluginFunction<TypescriptMocksPluginConfig>;
export {};
