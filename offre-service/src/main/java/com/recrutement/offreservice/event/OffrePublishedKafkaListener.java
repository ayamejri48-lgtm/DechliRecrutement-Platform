package com.recrutement.offreservice.event;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

@Component
@RequiredArgsConstructor
public class OffrePublishedKafkaListener {

    private final OffrePublishedProducer producer;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onOffrePublished(OffrePublishedEvent event) {
        producer.send(event);
    }
}
