#!/bin/bash
# Carga el portafolio de Data Servicios en el RAG (Vectorize)
# company_id = 2 (OpenClaw Labs, hasta que Data Servicios sea tenant propio)

WORKER_URL="https://enterprise-agent.novacodepro.workers.dev"
TOKEN="openclaw-admin-2026"
COMPANY_ID=2

upload() {
  local TITLE="$1"
  local CONTENT="$2"
  echo "Subiendo: $TITLE..."
  RESPONSE=$(curl -s -X POST "$WORKER_URL/api/admin/knowledge/upload" \
    -H "Content-Type: application/json" \
    -H "X-CF-Token: $TOKEN" \
    -d "$(jq -n \
      --argjson company_id "$COMPANY_ID" \
      --arg title "$TITLE" \
      --arg content "$CONTENT" \
      '{company_id: $company_id, title: $title, content: $content}')")
  echo "$RESPONSE"
  sleep 1
}

upload "Data Servicios — Perfil General" \
"EMPRESA: Data Servicios. PAÍS: Colombia. FUNDACIÓN: 2014 (más de 11 años en el mercado). SEDES: Bogotá (principal), Medellín, Cali. CLIENTES ATENDIDOS: Más de 500 empresas. EMPLEADOS: 7 unidades especializadas con equipos dedicados. SOPORTE: 24/7 disponible.

MISIÓN: Empoderar a nuestros clientes con un ecosistema tecnológico completo e innovador, desde hardware hasta consultoría estratégica. Entregar valor a través de la excelencia técnica, la cercanía humana y la creación de alianzas duraderas.

VISIÓN 2030: Ser el socio tecnológico referente en Colombia, reconocido por transformar la complejidad digital en soluciones integrales y sostenibles que impulsan el crecimiento y la competitividad de empresas.

PROPUESTA DE VALOR: Data Servicios entrega ecosistemas completos, no solamente componentes tecnológicos. Ofrecemos soluciones integradas, adaptadas a las necesidades de cada cliente.

PARTNERS TECNOLÓGICOS: Lenovo, HP, Dell, Cisco, Huawei, Microsoft, AWS, Azure, GCP, OutSystems, NVIDIA, OpenAI.
CERTIFICACIONES: ISO 27001, SOC2, SD-WAN, MPLS.
SECTORES: Banca, Sector Público, Educación, Retail, Medios, Manufactura, Telecomunicaciones, Salud.
DIFERENCIADORES: Acompañamiento de principio a fin, 7 unidades especializadas interconectadas, cross-sell natural, soporte 24/7, presencia en 3 ciudades, más de 11 años de experiencia."

upload "Data Servicios — Data Núcleo: Infraestructura y Networking" \
"UNIDAD: Data Núcleo. ÁREA: Infraestructura IT y Networking.
DESCRIPCIÓN: Redes, servidores, Cloud y monitoreo 24/7 para que la operación del cliente nunca se detenga. Diseño, implementación y gestión de infraestructura IT compleja.

SERVICIOS: Diseño e implementación de redes empresariales (LAN, WAN, SD-WAN, MPLS), servidores on-premise y cloud (AWS, Azure, GCP), almacenamiento empresarial (SAN, NAS), monitoreo 24/7 de infraestructura, migración a cloud híbrido, data centers, virtualización (VMware, Hyper-V), ciberseguridad de infraestructura.

TECNOLOGÍAS: Cisco, Huawei, AWS, Azure, GCP, VMware, Dell EMC, HPE.
CLIENTE IDEAL: Empresas medianas y grandes que necesitan infraestructura robusta, continuidad operativa, escalabilidad. Sectores: banca, salud, retail, manufactura.
AUDIENCIA PRINCIPAL: Gerentes de TI, CTOs, Directores de Operaciones.
CROSS-SELL: Data Ingenio (consultoría), Data Fuerza (hardware), Data Flujo (renting), Data Capital (financiamiento).
CASO DE ÉXITO: Colegio Gimnasio Británico — Aulas híbridas activas con monitores táctiles y videocolaboración."

upload "Data Servicios — Data Ingenio: Servicios Profesionales y Consultoría" \
"UNIDAD: Data Ingenio. ÁREA: Servicios Profesionales y Consultoría IT.
DESCRIPCIÓN: Consultoría especializada, auditorías, gestión de proyectos IT y soporte técnico avanzado N2/N3 con ingenieros certificados.

SERVICIOS: Consultoría IT estratégica, auditorías de infraestructura y seguridad, gestión de proyectos tecnológicos (PMO), soporte técnico avanzado N2/N3, staff augmentation (ingenieros certificados), evaluación y optimización de arquitectura IT, planes de continuidad de negocio (BCP/DRP).

CLIENTE IDEAL: Empresas que necesitan expertise técnico especializado sin contratar equipo permanente. Proyectos de transformación digital complejos.
AUDIENCIA PRINCIPAL: CTOs, Gerentes de TI, Directores de Proyectos.
CROSS-SELL: Data Núcleo (implementar recomendaciones), Data Control (automatizar procesos), Data Capital (financiar transformación)."

upload "Data Servicios — Data Fuerza: Hardware Empresarial" \
"UNIDAD: Data Fuerza. ÁREA: Hardware Empresarial y Transaccional.
DESCRIPCIÓN: Venta y distribución de equipos Lenovo, HP, Dell con asesoría personalizada, configuración e instalación incluida. Tecnología lista para el cliente, cuando la necesita.

SERVICIOS: Laptops y desktops empresariales (Lenovo, HP, Dell), monitores y periféricos profesionales, servidores y equipos de networking, configuración e instalación incluida, garantía extendida, distribución masiva para renovación de flotas, asesoría en selección de equipos.

MARCAS: Lenovo, HP, Dell, Cisco, Huawei.
CLIENTE IDEAL: Empresas que necesitan renovar equipos, ampliar flota, o equipar nuevas oficinas/sucursales.
AUDIENCIA PRINCIPAL: Gerentes de Compras, Directores Financieros, Gerentes de TI.
CROSS-SELL: Data Flujo (renting en vez de comprar), Data Capital (financiamiento de compra), Data Núcleo (instalación y red)."

upload "Data Servicios — Data Flujo: Renting Tecnológico" \
"UNIDAD: Data Flujo. ÁREA: Renting y Arrendamiento Tecnológico.
DESCRIPCIÓN: Tecnología actualizada con cuota fija mensual, sin inversión inicial. Usa, renueva y evoluciona sin atarte. Modelo OPEX en vez de CAPEX.

SERVICIOS: Renting de laptops, desktops y periféricos, renting de servidores y equipos de networking, cuota fija mensual todo incluido, renovación periódica de equipos, mantenimiento incluido, seguro contra daños, escalamiento flexible.

BENEFICIOS FINANCIEROS: Sin inversión inicial (CAPEX a OPEX), deducible de impuestos como gasto operativo, presupuesto predecible, sin depreciación de activos, tecnología siempre actualizada.
CLIENTE IDEAL: Empresas que priorizan liquidez, necesitan tecnología actualizada sin grandes inversiones, o tienen equipos que requieren renovación frecuente.
AUDIENCIA PRINCIPAL: CFOs, Directores Financieros, Gerentes de Compras, C-Levels.
CASO DE ÉXITO: Centro Comercial Santafé — Continuidad operativa en sistemas críticos en modelo renting."

upload "Data Servicios — Data Control: Automatización y Software" \
"UNIDAD: Data Control. ÁREA: Desarrollo de Software y Automatización.
DESCRIPCIÓN: Creación de aplicaciones web, móviles y plataformas low-code a medida. Primer entregable funcional en 6 semanas.

SERVICIOS: Desarrollo de aplicaciones web a medida, desarrollo de aplicaciones móviles (iOS, Android), plataformas low-code (OutSystems), automatización de procesos empresariales, integraciones con sistemas existentes (CRM, ERP, APIs), dashboards y reportería, chatbots y agentes de IA.

TECNOLOGÍAS: OutSystems, React, Node.js, Python, APIs REST.
CLIENTE IDEAL: Empresas que necesitan digitalizar procesos manuales, crear herramientas internas, o automatizar flujos de trabajo.
AUDIENCIA PRINCIPAL: Gerentes de TI, Directores de Operaciones, C-Levels que buscan transformación digital.
CASO DE ÉXITO: Canal Capital — Coordinación remota de equipos con infraestructura de videoconferencia y herramientas de colaboración."

upload "Data Servicios — Data Capital: Financiamiento IT" \
"UNIDAD: Data Capital. ÁREA: Financiamiento y Finanzas IT.
DESCRIPCIÓN: Leasing, crédito y estructuras financieras para que ningún proyecto tecnológico se detenga por presupuesto.

SERVICIOS: Leasing tecnológico, crédito para proyectos IT, estructuración financiera personalizada, modelos de pago flexibles, financiamiento de hardware y licencias, asesoría financiera para inversión tecnológica.

CLIENTE IDEAL: Empresas que tienen proyectos tecnológicos aprobados pero necesitan modelos de financiamiento que se ajusten a su flujo de caja.
AUDIENCIA PRINCIPAL: CFOs, Directores Financieros, Gerentes de Compras, C-Levels.
CROSS-SELL: Data Fuerza (financiar hardware), Data Núcleo (financiar infraestructura), Data Control (financiar software)."

upload "Data Servicios — Data Ciclo: Sostenibilidad y Economía Circular" \
"UNIDAD: Data Ciclo. ÁREA: Sostenibilidad y Economía Circular.
DESCRIPCIÓN: Manejo responsable de residuos electrónicos, economía circular y cumplimiento normativo ambiental.

SERVICIOS: Recolección y reciclaje de e-waste (residuos electrónicos), certificación de destrucción segura de datos, programas de recompra de equipos usados, cumplimiento normativo ambiental, reportes de impacto ESG, economía circular tecnológica.

CLIENTE IDEAL: Empresas con políticas ESG, regulaciones ambientales que cumplir, o flotas de equipos que necesitan retirarse responsablemente.
AUDIENCIA PRINCIPAL: Gerentes de Sostenibilidad, Directores de Compliance, C-Levels con agenda ESG.
CROSS-SELL: Data Fuerza (reemplazar equipos reciclados), Data Flujo (migrar a renting que incluye reciclaje), Data Capital (financiar renovación)."

upload "Data Servicios — Audiencias y Cómo Hablarles" \
"AUDIENCIAS DE DATA SERVICIOS:

C-LEVEL / DIRECTORES GENERALES: Enfoque en ROI, estrategia, ventaja competitiva, eficiencia de capital. Les importa retorno de inversión, escalabilidad, alianzas estratégicas a largo plazo. Unidades relevantes: Data Capital, Data Ingenio, Data Flujo. Tono: estratégico, cifras, visión de negocio.

GERENTES DE TI / CTOs / ESPECIALISTAS IT: Enfoque en estabilidad operativa, continuidad, seguridad, rendimiento. Les importa uptime, SLAs claros, integración con infra existente, soporte proactivo. Unidades relevantes: Data Núcleo, Data Ingenio, Data Control. Tono: técnico pero accesible, solución de problemas.

GERENTES DE COMPRAS / DIRECTORES FINANCIEROS: Enfoque en valor claro, presupuesto, modelos financieros flexibles. Les importa propuestas transparentes, comparativas, TCO vs competencia. Unidades relevantes: Data Fuerza, Data Capital, Data Flujo. Tono: pragmático, números claros, ROI demostrable.

PÚBLICO GENERAL / MARCA: Enfoque en humanización, impacto social, innovación. Unidades relevantes: Data Ciclo, marca corporativa. Tono: cercano, inspirador, storytelling."

upload "Data Servicios — Smart Friday: Campaña Comercial Mensual" \
"SMART FRIDAY — Campaña Comercial Mensual de Data Servicios.
CONCEPTO: La decisión que tomas por precio hoy, la paga tu equipo mañana. No vende ofertas; ofrece buenas decisiones.

PILARES NARRATIVOS: Valor no precio, tecnología que evita problemas, eficiencia real, rentabilidad sostenida, impacto social y ambiental como plus diferencial.

OFERTAS POR UNIDAD: Data Núcleo (Infraestructura sin fricción — servidores + redes + instalación), Data Ingenio (Auditoría IT Inteligente gratuita), Data Fuerza (Combo Inteligente: laptop + monitor + diadema + garantía), Data Flujo (Primer mes al 50%), Data Control (Diagnóstico de procesos gratis), Data Capital (Financiación especial Smart Friday), Data Ciclo (Plan de Recompra Inteligente).

DATO CLAVE: El 73% de empresas que compran tecnología por precio terminan gastando 2.4x más en los siguientes 18 meses (Gartner).

SECTORES OBJETIVO: Banca, Sector Público, Educación, Retail, Manufactura, Salud, Telecomunicaciones."

echo ""
echo "✅ Carga completada. Verifica con: GET $WORKER_URL/api/admin/knowledge/docs?company_id=$COMPANY_ID"
