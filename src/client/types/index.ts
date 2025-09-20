export interface GetInitialData {
	summary: Summary;
	accounts: Account[];
	transactions: Transaction[];
	budgets: Budget[];
}

export interface Account {
	NombreCuenta: string;
	FechaCorte: string;
	SaldoActual: number;
	TipoDeCuenta: string;
	Moneda: string;
	ID: string;
	FechaPago: string;
	BancoEntidad: string;
	LimiteCredito: string;
}

export interface Budget {
	MontoPresupuestado: number;
	Moneda: string;
	Categoria: string;
	Mes: string;
	ID: string;
	porcentaje: number;
	diferencia: number;
	gastoReal: number;
}

export interface Summary {
	monthlyExpenses: { [key: string]: number };
	totalBalance: { [key: string]: number };
	monthlyIncome: { [key: string]: number };
}

export interface Transaction {
	Tipo: Tipo;
	Categoria: string;
	ReferenciaID: string;
	Fecha: Date;
	Monto: number;
	CuentaID: string;
	Descripcion: string;
	ID: string;
}

export type Tipo = 'Gasto' | 'Ingreso';
