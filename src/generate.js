import Prefixer from 'inline-style-prefixer';

import {
    objectToPairs, kebabifyStyleName, recursiveMerge, stringifyValue,
    importantify,
} from './util';

// In a bundle of styles, find all of the different class names that a single
// named descendant selector can have.
const findNamesForDescendants = (styles, names) => {
    Object.keys(styles).forEach(key => {
        if (key[0] === ':' || key[0] === '@') {
            // Recurse for pseudo or @media styles
            findNamesForDescendants(styles[key], names);
        } else if (key[0] === '>' && key[1] === '>') {
            // Recurse for descendant styles
            findNamesForDescendants(styles[key], names);

            // Pluck out all of the names in the _names object.
            Object.keys(styles[key]._names).forEach(name => {
                names[key] = names[key] || [];
                names[key].push(name);
            });
        }
    });
};

export const generateCSS = (selector, styleTypes, stringHandlers,
                            useImportant) => {
    const merged = styleTypes.reduce(recursiveMerge);

    const classNamesForDescendant = {};
    findNamesForDescendants(merged, classNamesForDescendant);

    return generateCSSInner(
        selector, merged, stringHandlers, useImportant,
        classNamesForDescendant);
}

const generateCSSInner = (selector, style, stringHandlers,
                          useImportant, classNamesForDescendant) => {
    const declarations = {};
    const mediaQueries = {};
    const descendants = {};
    const pseudoStyles = {};

    Object.keys(style).forEach(key => {
        if (key[0] === ':') {
            pseudoStyles[key] = style[key];
        } else if (key[0] === '@') {
            mediaQueries[key] = style[key];
        } else if (key[0] === '>' && key[1] === '>') {
            // So we don't generate weird "_names: [Object object]" styles,
            // make a copy of the styles and get rid of the _names value.
            const stylesWithoutNames = {
                ...style[key],
            };
            delete stylesWithoutNames._names;

            // Since our child might have many different names, generate the
            // styles for all of the possible ones.
            classNamesForDescendant[key].forEach(name => {
                descendants[name] = stylesWithoutNames;
            });
        } else {
            declarations[key] = style[key];
        }
    });

    return (
        generateCSSRuleset(selector, declarations, stringHandlers,
            useImportant) +
        Object.keys(pseudoStyles).map(pseudoSelector => {
            return generateCSSInner(
                selector + pseudoSelector, pseudoStyles[pseudoSelector],
                stringHandlers, useImportant, classNamesForDescendant);
        }).join("") +
        Object.keys(mediaQueries).map(mediaQuery => {
            const ruleset = generateCSSInner(
                selector, mediaQueries[mediaQuery], stringHandlers,
                useImportant, classNamesForDescendant);
            return `${mediaQuery}{${ruleset}}`;
        }).join("") +
        Object.keys(descendants).map(descendant => {
            return generateCSSInner(
                `${selector} .${descendant}`, descendants[descendant],
                stringHandlers, useImportant, classNamesForDescendant);
        }).join("")
    );
};

const runStringHandlers = (declarations, stringHandlers) => {
    const result = {};

    Object.keys(declarations).forEach(key => {
        // If a handler exists for this particular key, let it interpret
        // that value first before continuing
        if (stringHandlers && stringHandlers.hasOwnProperty(key)) {
            result[key] = stringHandlers[key](declarations[key]);
        } else {
            result[key] = declarations[key];
        }
    });

    return result;
};

export const generateCSSRuleset = (selector, declarations, stringHandlers,
        useImportant) => {
    const handledDeclarations = runStringHandlers(
        declarations, stringHandlers);

    const prefixedDeclarations = Prefixer.prefixAll(handledDeclarations);

    const rules = objectToPairs(prefixedDeclarations).map(([key, value]) => {
        const stringValue = stringifyValue(key, value);
        const ret = `${kebabifyStyleName(key)}:${stringValue};`;
        return useImportant === false ? ret : importantify(ret);
    }).join("");

    if (rules) {
        return `${selector}{${rules}}`;
    } else {
        return "";
    }
};
