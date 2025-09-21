import { Button } from '@/client/components/ui/button';
import { serverFunctions } from '@/client/lib/client';

function App() {
	async function send() {
		await serverFunctions.sendEmail('Prueba desde React');
	}

	return (
		<>
			<h1>Hola</h1>
			<Button onClick={send}>Send mail</Button>
		</>
	);
}

export default App;
