export function sheetToJsonFromName<T extends object>(
	sheetName: string,
	options?: {
		useDisplayValues?: boolean;
		dateFormat?: string; // ejemplo: 'yyyy-MM-dd' o 'dd/MM/yyyy HH:mm'
		timezone?: string;
		emptyAsNull?: boolean;
	},
): T[] {
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	if (!ss) throw new Error('No se encontró el Spreadsheet activo.');
	const sheet = ss.getSheetByName(sheetName);
	if (!sheet) return [];

	const useDisplay = !!options?.useDisplayValues;
	const rawRange = sheet.getDataRange();
	const values: any[][] = useDisplay ? (rawRange.getDisplayValues() as string[][]) : (rawRange.getValues() as any[][]);

	if (!values || values.length === 0) return [];

	// Encabezados (primera fila)
	const rawHeaders = values[0].map((h) => (h == null ? '' : String(h).trim()));
	if (rawHeaders.every((h) => typeof h !== 'string' || h.trim() === '')) {
		throw new Error('La fila de encabezados está vacía.');
	}

	// Función para pasar a camelCase (normaliza acentos, quita caracteres no alfanuméricos)
	const toCamelCase = (input: string) => {
		if (!input) return '';
		// quitar BOM si existe
		const noBOM = input.replace(/^\uFEFF/, '');
		// Normaliza y quita acentos (NFD + eliminación de marcas diacríticas)
		const noAccents = noBOM.normalize?.('NFD').replace(/[\u0300-\u036f]/g, '') ?? noBOM;
		// Reemplaza cualquier caracter no alfanumérico por espacio, trim y pasar a minúsculas
		const cleaned = noAccents
			.replace(/[^0-9a-zA-Z]+/g, ' ')
			.trim()
			.toLowerCase();
		const parts = cleaned.split(/\s+/).filter((p) => p.length > 0);
		if (parts.length === 0) return '';
		let camel = parts.map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))).join('');
		// Si comienza con número, prefija con _
		if (/^[0-9]/.test(camel)) camel = '_' + camel;
		return camel;
	};

	// Limpiar encabezados, convertir a camelCase y asegurar unicidad (añade _1, _2 si hace falta)
	const headersRawCamel = rawHeaders.map((h) => toCamelCase(String(h ?? '').trim()));
	const seen: Record<string, number> = {};
	const headers = headersRawCamel.map((h) => {
		if (!h) return ''; // dejamos vacío (luego se salta)
		if (seen[h] === undefined) {
			seen[h] = 0;
			return h;
		} else {
			seen[h]++;
			return `${h}_${seen[h]}`;
		}
	});

	const tz = options?.timezone || ss.getSpreadsheetTimeZone();
	const dateFormat = options?.dateFormat;
	const emptyAsNull = !!options?.emptyAsNull;

	const result: T[] = [];

	// Recorremos filas (desde la 2ª fila)
	for (let r = 1; r < values.length; r++) {
		const row = values[r] as any[];
		const rowHasAny = row.some((cell) => cell !== '' && cell !== null && cell !== undefined);
		if (!rowHasAny) continue;

		const obj = {} as T;
		for (let c = 0; c < headers.length; c++) {
			const key = headers[c];
			if (!key) continue;

			let cell = row[c];

			if (useDisplay) {
				// Todo viene como string
				if (cell === '' || cell === null || cell === undefined) {
					(obj as any)[key] = emptyAsNull ? null : '';
				} else {
					(obj as any)[key] = String(cell).trim();
				}
			} else {
				// Raw values
				if (cell === '' || cell === null || cell === undefined) {
					(obj as any)[key] = emptyAsNull ? null : '';
				} else if (cell instanceof Date) {
					if (dateFormat) {
						(obj as any)[key] = Utilities.formatDate(cell, tz, dateFormat);
					} else {
						(obj as any)[key] = (cell as Date).toISOString();
					}
				} else {
					(obj as any)[key] = cell;
				}
			}
		}

		const hasValue = Object.keys(obj).some((k) => {
			const v = (obj as any)[k];
			return v !== undefined && v !== '' && v !== null;
		});
		if (hasValue) result.push(obj);
	}

	return result;
}
